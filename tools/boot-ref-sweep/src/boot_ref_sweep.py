#!/usr/bin/env python3
"""boot-ref-sweep — pre-removal dangling-reference checker.

Before a drive is wiped, pulled, or decommissioned, sweep every surface
that might still reference its filesystems:

  * /etc/fstab (live) and its backups (classified separately)
  * /etc/crypttab
  * /etc/default/grub and /boot/grub/grub.cfg
  * /etc/kernel/cmdline, dracut config (/etc/dracut.conf, .d/*)
  * systemd *.mount units under /etc/systemd/system and /usr/lib/systemd/system
  * initramfs images under /boot — the CONTENTS are unpacked/scanned,
    because dracut bakes devexists wait-hooks into the image at build
    time (the Oct 24-25 Tritium outage: ghost UUIDs 037a1434 / E1C3-D1B2
    lived only inside Oct 10 initramfs images, satisfied until the
    AirDisk carrying the old /boot+ESP was wiped)
  * an efibootmgr dump (--efibootmgr FILE, or root/var/lib/... text)

Identifiers are matched case-insensitively (vfat UUIDs print upper-case,
configs may carry either case) and may be filesystem UUIDs, PARTUUIDs,
labels, serials, or /dev/disk/by-id fragments.

Verdicts:
  BLOCKED    a live (non-backup) surface references an identifier
  INCOMPLETE a surface that should have been scanned could not be
             (e.g. an initramfs whose compression cannot be decoded)
  WARN       references exist only in backup/historical files
  CLEAN      no references anywhere scanned

Exit codes: 0 = CLEAN or WARN, 1 = BLOCKED, 2 = INCOMPLETE or usage error.
Read-only: this tool never writes to the swept root.
"""
from __future__ import annotations

import argparse
import bz2
import gzip
import json
import lzma
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field

BACKUP_MARKERS = (".bak", ".old", ".save", "~", "backup", "migration-bak",
                  ".orig", ".dpkg-old", ".ucf-old")

TEXT_SURFACES = [
    ("fstab", "etc/fstab"),
    ("fstab", "etc/fstab.*"),                      # backups / variants
    ("crypttab", "etc/crypttab"),
    ("grub-default", "etc/default/grub"),
    ("grub-config", "boot/grub/grub.cfg"),
    ("grub-config", "boot/grub2/grub.cfg"),
    ("kernel-cmdline", "etc/kernel/cmdline"),
    ("dracut-config", "etc/dracut.conf"),
    ("dracut-config", "etc/dracut.conf.d/*.conf"),
    ("systemd-mount", "etc/systemd/system/*.mount"),
    ("systemd-mount", "usr/lib/systemd/system/*.mount"),
    ("systemd-unit", "etc/systemd/system/*.automount"),
]

INITRAMFS_GLOBS = ["boot/initrd.img-*", "boot/initramfs-*.img",
                   "boot/initrd-*", "boot/initramfs*"]


def is_backup(path: str) -> bool:
    name = os.path.basename(path).lower()
    return any(m in name for m in BACKUP_MARKERS)


@dataclass
class Hit:
    surface: str
    path: str
    identifier: str
    live: bool
    detail: str = ""


@dataclass
class Sweep:
    hits: list = field(default_factory=list)
    unverified: list = field(default_factory=list)
    scanned: list = field(default_factory=list)


def norm(s: str) -> str:
    return s.lower()


def find_ids(text: str, identifiers: list[str]) -> list[str]:
    low = norm(text)
    return [i for i in identifiers if norm(i) in low]


def scan_text_file(sweep: Sweep, surface: str, path: str, root: str,
                   identifiers: list[str]) -> None:
    rel = os.path.relpath(path, root)
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read()
    except OSError as exc:
        sweep.unverified.append(f"{rel}: unreadable ({exc.strerror or exc})")
        return
    sweep.scanned.append(rel)
    live = not is_backup(path)
    for lineno, line in enumerate(content.splitlines(), 1):
        for ident in find_ids(line, identifiers):
            sweep.hits.append(Hit(surface, rel, ident, live,
                                  f"line {lineno}: {line.strip()[:160]}"))


# --- initramfs decoding -------------------------------------------------
GZIP_MAGIC = b"\x1f\x8b"
XZ_MAGIC = b"\xfd7zXZ\x00"
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
BZIP2_MAGIC = b"BZh"


def _try_decompress(data: bytes, offset: int) -> bytes | None:
    chunk = data[offset:]
    # decompressobj forms tolerate trailing bytes after the stream
    # (concatenated images / padding), which *.decompress() rejects.
    def _obj(factory):
        d = factory()
        out = d.decompress(chunk)
        return out or None
    import zlib
    for factory in (lambda: zlib.decompressobj(31), lzma.LZMADecompressor,
                    bz2.BZ2Decompressor):
        try:
            out = _obj(factory)
            if out:
                return out
        except Exception:
            pass
    for fn in (gzip.decompress, lzma.decompress, bz2.decompress):
        try:
            return fn(chunk)
        except Exception:
            pass
    # zstd is not in the stdlib (py<3.14); use the CLI when present.
    exe = shutil.which("zstd") or shutil.which("unzstd")
    if exe:
        try:
            out = subprocess.run([exe, "-dc"], input=chunk,
                                 capture_output=True, timeout=120)
            if out.returncode == 0 and out.stdout:
                return out.stdout
        except Exception:
            pass
    return None


def initramfs_searchable_bytes(data: bytes) -> tuple[bytes, bool]:
    """Return (searchable_bytes, fully_decoded).

    Layout: an optional uncompressed early (microcode) cpio, then ONE
    compressed main cpio. Searchable bytes = the raw early-cpio prefix
    plus the decoded main frame — never the raw compressed blob
    (scanning compressed bytes both misses real content and produces
    fragment false-positives, verified on Tritium's live images).

    Candidate frame offsets are tried in increasing order; the first
    decode that yields a substantial payload is the main frame.
    fully_decoded is False when compression magics are present but no
    candidate decoded — the caller must treat the image as unverified,
    never as clean.
    """
    candidates: list[int] = []
    for magic in (GZIP_MAGIC, XZ_MAGIC, ZSTD_MAGIC, BZIP2_MAGIC):
        start = 0
        for _ in range(8):                    # first few per format only
            idx = data.find(magic, start)
            if idx < 0:
                break
            candidates.append(idx)
            start = idx + 1
    if not candidates:
        return data, True                     # plain (uncompressed) cpio
    best: tuple[int, bytes] | None = None
    for idx in sorted(set(candidates)):
        out = _try_decompress(data, idx)
        if out and (best is None or len(out) > len(best[1])):
            best = (idx, out)
    if best is not None:
        return data[:best[0]] + best[1], True
    return data[:min(candidates)], False


def scan_initramfs(sweep: Sweep, path: str, root: str,
                   identifiers: list[str]) -> None:
    rel = os.path.relpath(path, root)
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        sweep.unverified.append(f"{rel}: unreadable ({exc.strerror or exc})")
        return
    searchable, complete = initramfs_searchable_bytes(data)
    if not complete:
        sweep.unverified.append(
            f"{rel}: compression present but could not be decoded "
            f"(no gzip/xz/bz2/zstd decoder succeeded) — contents unverified")
        return
    sweep.scanned.append(rel)
    text = searchable.decode("utf-8", errors="ignore")
    live = not is_backup(path)
    for ident in find_ids(text, identifiers):
        # Context: the cpio member name or hook path around the match.
        idx = norm(text).find(norm(ident))
        ctx = text[max(0, idx - 120):idx + len(ident) + 40]
        ctx = " ".join(ctx.split())
        sweep.hits.append(Hit("initramfs", rel, ident, live,
                              f"in image contents near: …{ctx[-170:]}"))


def run(root: str, identifiers: list[str],
        efibootmgr_file: str | None = None) -> Sweep:
    sweep = Sweep()
    seen: set[str] = set()
    import glob as globmod
    for surface, pattern in TEXT_SURFACES:
        for path in sorted(globmod.glob(os.path.join(root, pattern))):
            if path in seen or not os.path.isfile(path):
                continue
            seen.add(path)
            scan_text_file(sweep, surface, path, root, identifiers)
    for pattern in INITRAMFS_GLOBS:
        for path in sorted(globmod.glob(os.path.join(root, pattern))):
            if path in seen or not os.path.isfile(path):
                continue
            seen.add(path)
            scan_initramfs(sweep, path, root, identifiers)
    if efibootmgr_file:
        if os.path.isfile(efibootmgr_file):
            fake = Sweep()
            scan_text_file(fake, "efibootmgr", efibootmgr_file,
                           os.path.dirname(os.path.abspath(efibootmgr_file)),
                           identifiers)
            for h in fake.hits:
                h.path = f"efibootmgr:{os.path.basename(efibootmgr_file)}"
                sweep.hits.append(h)
            sweep.scanned.extend(fake.scanned)
            sweep.unverified.extend(fake.unverified)
        else:
            sweep.unverified.append(
                f"efibootmgr dump not found: {efibootmgr_file}")
    return sweep


def verdict(sweep: Sweep) -> str:
    if any(h.live for h in sweep.hits):
        return "BLOCKED"
    if sweep.unverified:
        return "INCOMPLETE"
    if sweep.hits:
        return "WARN"
    return "CLEAN"


EXIT = {"CLEAN": 0, "WARN": 0, "BLOCKED": 1, "INCOMPLETE": 2}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Sweep boot/system surfaces for references to a "
                    "drive's identifiers before removing or wiping it.")
    ap.add_argument("--root", default="/",
                    help="filesystem root to sweep (default /)")
    ap.add_argument("--uuid", action="append", default=[],
                    help="filesystem UUID or PARTUUID (repeatable)")
    ap.add_argument("--id", action="append", default=[], dest="extra_ids",
                    help="label, serial, or by-id fragment (repeatable)")
    ap.add_argument("--efibootmgr", metavar="FILE",
                    help="file containing `efibootmgr -v` output to scan")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    identifiers = list(args.uuid) + list(args.extra_ids)
    if not identifiers:
        print("error: at least one --uuid or --id is required",
              file=sys.stderr)
        return 2
    if not os.path.isdir(args.root):
        print(f"error: root is not a directory: {args.root}", file=sys.stderr)
        return 2

    sweep = run(args.root, identifiers, args.efibootmgr)
    v = verdict(sweep)
    if args.json:
        print(json.dumps({
            "root": args.root, "identifiers": identifiers, "verdict": v,
            "hits": [vars(h) for h in sweep.hits],
            "unverified": sweep.unverified,
            "scanned": sweep.scanned,
        }, indent=2))
    else:
        print(f"boot-ref-sweep: root={args.root} "
              f"identifiers={', '.join(identifiers)}")
        for h in sweep.hits:
            print(f"  {'LIVE ' if h.live else 'BACKUP'} [{h.surface}] "
                  f"{h.path} :: {h.identifier} — {h.detail}")
        for u in sweep.unverified:
            print(f"  UNVERIFIED: {u}")
        print(f"  scanned {len(sweep.scanned)} surface(s), "
              f"{len(sweep.hits)} hit(s)")
        print(f"VERDICT: {v}")
        if v == "BLOCKED":
            print("Do NOT remove/wipe the drive until the live "
                  "references above are fixed and the sweep is re-run.")
        elif v == "INCOMPLETE":
            print("Removal is NOT cleared: some surfaces could not be "
                  "verified.")
        elif v == "WARN":
            print("No live references. Backup files still mention the "
                  "drive — harmless for boot, keep in mind for restores.")
    return EXIT[v]


if __name__ == "__main__":
    raise SystemExit(main())
