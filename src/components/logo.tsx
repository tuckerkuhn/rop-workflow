/* eslint-disable @next/next/no-img-element -- the supplied brand files are SVG artwork, shown as they are */

/**
 * The Roots of Peace marks, from the supplied brand files (public/brand). The brand guidelines treat
 * the mark as finished art: never redrawn, recoloured, stretched or given effects.
 *
 * - LogoMark: the sapling icon, for anywhere too small for the full lockup (under 120 px wide).
 * - Logo: the full ROOTS OF PEACE lockup, at least 120 px wide. The standard colour version on
 *   light screens, the white version on dark ones (or always white with `onDark`).
 */

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <picture className={`inline-flex shrink-0 items-center justify-center ${className}`}>
      <source srcSet="/brand/rop-icon-white-on-green.svg" media="(prefers-color-scheme: dark)" />
      <img src="/brand/rop-icon.svg" alt="" aria-hidden="true" className="h-full w-auto" />
    </picture>
  );
}

export function Logo({ className = "w-[150px]", onDark = false }: { className?: string; onDark?: boolean }) {
  if (onDark) return <img src="/brand/rop-logo-white.svg" alt="Roots of Peace" className={`h-auto min-w-[120px] ${className}`} />;
  return (
    <picture className={`inline-block shrink-0 ${className}`}>
      <source srcSet="/brand/rop-logo-white.svg" media="(prefers-color-scheme: dark)" />
      <img src="/brand/rop-logo.svg" alt="Roots of Peace" className="h-auto w-full min-w-[120px]" />
    </picture>
  );
}
