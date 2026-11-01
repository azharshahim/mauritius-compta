/**
 * COMPTAI brand mark.
 *
 * The asset is served from `public/` so the same file is used by the header,
 * the login screen, the favicon family and the PWA manifest. `BASE_URL` keeps
 * it correct under the GitHub Pages demo sub-path and at the root of the real
 * application.
 */
export function BrandMark({ size = 34, className = 'brand-mark' }: { size?: number; className?: string }) {
  const src = `${import.meta.env.BASE_URL}comptai-mark.svg`;
  return (
    <img
      className={className}
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  );
}
