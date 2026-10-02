/**
 * An <img> that fetches Nebula media through the API client instead of a
 * bare URL. On the tailnet a plain <img src> works (Tailscale identity
 * headers do the auth), but off-tailnet the passphrase must ride an
 * `Authorization` header — which <img> cannot send. So this component
 * fetches the bytes with the header applied and renders an object URL.
 *
 * Honest failure: a tile that cannot load says so instead of showing a
 * broken image or a fake placeholder.
 */
import { useEffect, useState } from 'react';
import { fetchMediaBlob } from '../../api/nebula';

export interface AuthenticatedImageProps {
  baseUrl: string;
  passphrase: string;
  path: string;
  kind: 'thumb' | 'file';
  size?: number;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}

export function AuthenticatedImage({
  baseUrl,
  passphrase,
  path,
  kind,
  size,
  alt,
  className,
  style,
}: AuthenticatedImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    const ctrl = new AbortController();
    setUrl(null);
    setFailed(false);
    fetchMediaBlob(baseUrl, path, kind, {
      passphrase,
      signal: ctrl.signal,
      size,
    })
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, passphrase, path, kind, size]);

  if (failed) {
    return (
      <div
        className={['flex', 'items-center', 'justify-center', 'text-xs', 'text-text-secondary', className ?? '']
          .filter(Boolean)
          .join(' ')}
        style={style}
        role="img"
        aria-label={alt + ' (failed to load)'}
      >
        <span>Couldn't load image</span>
      </div>
    );
  }
  if (!url) {
    return (
      <div
        className={['skel', className ?? ''].filter(Boolean).join(' ')}
        style={{ minHeight: 96, ...style }}
        aria-hidden="true"
      />
    );
  }
  return <img src={url} alt={alt} className={className} style={style} loading="lazy" />;
}
