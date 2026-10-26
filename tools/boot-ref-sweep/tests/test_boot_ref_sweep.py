import gzip
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src", "boot_ref_sweep.py")
sys.path.insert(0, os.path.join(HERE, "..", "src"))
import boot_ref_sweep as brs  # noqa: E402

GHOST_BOOT = "037a1434-1111-2222-3333-444455556666"
GHOST_ESP = "E1C3-D1B2"
LIVE_BOOT = "ea1a3177-e41f-442f-8f4c-e0822f542551"


def write(root, rel, text):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        fh.write(text)
    return p


def newc(entries):
    """Build a minimal newc cpio archive from [(name, bytes), ...]."""
    out = bytearray()
    ino = 1
    for name, data in entries:
        nb = name.encode() + b"\x00"
        fields = [ino, 0o100644, 0, 0, 1, 0, len(data), 0, 0, 0, 0,
                  len(nb), 0]
        hdr = "070701" + "".join(f"{f:08x}" for f in fields)
        out.extend(hdr.encode())
        out.extend(nb)
        out.extend(b"\x00" * ((4 - (len(hdr) + len(nb)) % 4) % 4))
        out.extend(data)
        out.extend(b"\x00" * ((4 - len(data) % 4) % 4))
        ino += 1
    nb = b"TRAILER!!!\x00"
    fields = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, len(nb), 0]
    hdr = "070701" + "".join(f"{f:08x}" for f in fields)
    out.extend(hdr.encode())
    out.extend(nb)
    out.extend(b"\x00" * ((4 - (len(hdr) + len(nb)) % 4) % 4))
    out.extend(b"\x00" * 256)
    return bytes(out)


def write_initrd(root, name, entries, compress=True):
    p = os.path.join(root, "boot", name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    raw = newc(entries)
    with open(p, "wb") as fh:
        fh.write(gzip.compress(raw) if compress else raw)
    return p


def cli(root, *ids, extra=()):
    cmd = [sys.executable, SRC, "--root", root]
    for i in ids:
        cmd += ["--uuid", i]
    cmd += list(extra)
    return subprocess.run(cmd, capture_output=True, text=True)


class SweepTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = self.tmp

    def test_clean_tree(self):
        write(self.root, "etc/fstab",
              f"UUID={LIVE_BOOT} /boot ext4 defaults 0 2\n")
        write_initrd(self.root, "initrd.img-6.8",
                     [("conf/cmdline", b"root=UUID=aaaa\n")])
        r = cli(self.root, GHOST_BOOT, GHOST_ESP)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("VERDICT: CLEAN", r.stdout)

    def test_live_fstab_hit_blocks(self):
        write(self.root, "etc/fstab",
              f"UUID={GHOST_BOOT} /boot ext4 defaults 0 2\n")
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1)
        self.assertIn("VERDICT: BLOCKED", r.stdout)
        self.assertIn("Do NOT remove/wipe", r.stdout)

    def test_backup_only_is_warn_not_blocked(self):
        # The real Oct 25 finding: ghosts lived only in fstab backups.
        write(self.root, "etc/fstab",
              f"UUID={LIVE_BOOT} /boot ext4 defaults 0 2\n")
        write(self.root, "etc/fstab.migration-bak",
              f"UUID={GHOST_BOOT} /boot ext4 defaults 0 2\n")
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 0)
        self.assertIn("VERDICT: WARN", r.stdout)

    def test_grub_cfg_hit_blocks(self):
        write(self.root, "boot/grub/grub.cfg",
              f"search --fs-uuid --set=root {GHOST_BOOT}\n")
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1)
        self.assertIn("grub-config", r.stdout)

    def test_default_grub_and_cmdline(self):
        write(self.root, "etc/default/grub",
              f'GRUB_CMDLINE_LINUX="root=UUID={GHOST_BOOT}"\n')
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1)

    def test_crypttab_hit(self):
        write(self.root, "etc/crypttab",
              f"crypt1 UUID={GHOST_BOOT} none luks\n")
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1)
        self.assertIn("crypttab", r.stdout)

    def test_systemd_mount_hit(self):
        write(self.root, "etc/systemd/system/mnt-old.mount",
              f"[Mount]\nWhat=/dev/disk/by-uuid/{GHOST_BOOT}\nWhere=/mnt/old\n")
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1)
        self.assertIn("systemd-mount", r.stdout)

    def test_case_insensitive_vfat_uuid(self):
        write(self.root, "etc/fstab", f"UUID={GHOST_ESP.lower()} /boot/efi vfat defaults 0 2\n")
        r = cli(self.root, GHOST_ESP)
        self.assertEqual(r.returncode, 1)

    def test_extra_id_label_and_serial(self):
        write(self.root, "etc/fstab", "LABEL=OLDBOOT /boot ext4 defaults 0 2\n")
        p = subprocess.run([sys.executable, SRC, "--root", self.root,
                            "--id", "OLDBOOT"], capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)

    def test_initramfs_hook_filename_hit_blocks(self):
        # The actual outage mechanism: a devexists hook baked into the image.
        hook = (f"var/lib/dracut/hooks/initqueue/finished/"
                f"devexists-\\x2fdev\\x2fdisk\\x2fby-uuid\\x2f{GHOST_BOOT}.sh")
        write_initrd(self.root, "initrd.img-7.0.0-38-generic",
                     [(hook, b"#!/bin/sh\n")])
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("initramfs", r.stdout)

    def test_initramfs_embedded_fstab_content_hit(self):
        write_initrd(self.root, "initrd.img-6.8",
                     [("etc/fstab", f"UUID={GHOST_ESP} /boot/efi vfat\n".encode())])
        r = cli(self.root, GHOST_ESP)
        self.assertEqual(r.returncode, 1)

    def test_initramfs_uncompressed_cpio_hit(self):
        write_initrd(self.root, "initrd.img-6.8",
                     [("hooks/x", f"wait {GHOST_BOOT}".encode())],
                     compress=False)
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1)

    def test_initramfs_early_cpio_plus_gzip_main(self):
        # early microcode cpio (raw) concatenated with gzipped main image
        early = newc([("kernel/microcode", b"\x00" * 32)])
        main = gzip.compress(newc([("etc/cmdline",
                                    f"root=UUID={GHOST_BOOT}".encode())]))
        p = os.path.join(self.root, "boot", "initrd.img-6.8")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(early + main)
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1, r.stdout)

    def test_undecodable_initramfs_is_incomplete_not_clean(self):
        # gzip magic followed by garbage: decoder fails -> INCOMPLETE (2),
        # never silently CLEAN.
        p = os.path.join(self.root, "boot", "initrd.img-6.8")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(b"\x1f\x8b" + b"not-a-real-gzip-stream" * 8)
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 2, r.stdout)
        self.assertIn("INCOMPLETE", r.stdout)

    def test_json_output(self):
        write(self.root, "etc/fstab", f"UUID={GHOST_BOOT} /boot ext4 defaults 0 2\n")
        p = cli(self.root, GHOST_BOOT, extra=("--json",))
        data = json.loads(p.stdout)
        self.assertEqual(data["verdict"], "BLOCKED")
        self.assertEqual(len(data["hits"]), 1)
        self.assertTrue(data["hits"][0]["live"])

    def test_efibootmgr_dump_hit(self):
        dump = os.path.join(self.tmp, "efi.txt")
        with open(dump, "w") as fh:
            fh.write(f"Boot0002* OldDisk HD(1,GPT,{GHOST_BOOT},0x800,0x1000)/File(\\EFI\\ubuntu\\shimx64.efi)\n")
        p = cli(self.root, GHOST_BOOT, extra=("--efibootmgr", dump))
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn("efibootmgr", p.stdout)

    def test_no_identifier_is_usage_error(self):
        p = subprocess.run([sys.executable, SRC, "--root", self.root],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)

    def test_missing_root_is_error(self):
        p = cli(os.path.join(self.tmp, "nope"), GHOST_BOOT)
        self.assertEqual(p.returncode, 2)

    def test_dracut_conf_hit(self):
        write(self.root, "etc/dracut.conf.d/99-old.conf",
              f'# was built for {GHOST_BOOT}\n')
        r = cli(self.root, GHOST_BOOT)
        self.assertEqual(r.returncode, 1)

    def test_multiple_identifiers_report_each(self):
        write(self.root, "etc/fstab",
              f"UUID={GHOST_BOOT} /boot ext4 defaults 0 2\n"
              f"UUID={GHOST_ESP} /boot/efi vfat defaults 0 2\n")
        data = json.loads(cli(self.root, GHOST_BOOT, GHOST_ESP,
                              extra=("--json",)).stdout)
        found = {h["identifier"] for h in data["hits"]}
        self.assertEqual(found, {GHOST_BOOT, GHOST_ESP})


if __name__ == "__main__":
    unittest.main()

class DecoderSegmentTests(unittest.TestCase):
    def test_trailing_raw_bytes_after_frame_not_searched(self):
        # An identifier sitting in raw bytes AFTER the compressed frame
        # (not inside any cpio member) must not be reported: raw
        # compressed-blob scanning produced fragment false-positives
        # on Tritium's live images on 2026-10-25.
        main = gzip.compress(newc([("etc/cmdline", b"root=UUID=aaaa\n")]))
        data = newc([("kernel/microcode", b"\x00" * 64)]) + main + \
            f"trailing-{GHOST_BOOT}".encode()
        searchable, complete = brs.initramfs_searchable_bytes(data)
        self.assertTrue(complete)
        self.assertNotIn(GHOST_BOOT.encode(), searchable)

    def test_early_cpio_prefix_is_searched(self):
        early = newc([("hooks/early", f"wait {GHOST_BOOT}".encode())])
        main = gzip.compress(newc([("etc/cmdline", b"root=UUID=aaaa\n")]))
        searchable, complete = brs.initramfs_searchable_bytes(early + main)
        self.assertTrue(complete)
        self.assertIn(GHOST_BOOT.encode(), searchable)
