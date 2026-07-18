# Liquid Glass icon layers — ORIGINAL halftone logo

Prepped for **Icon Composer** (`/Applications/Xcode.app/Contents/Applications/Icon Composer.app`),
Apple's GUI tool for the layered `.icon` format iOS 26 uses for Liquid Glass app icons.
The steps below must be done by hand in the app — there is no CLI/scripting path.

## Files

- `foreground-flower-original.png` — the **original halftone-dot flower logo, untouched**
  (729×754 RGBA, transparent background). These are the exact bytes embedded in
  `Assets.xcassets/logo-flower.imageset/logo-flower.svg` — extracted, not redrawn,
  not recolored. The dotted CMYK-halftone texture is the intentional brand design.

No background layer file is needed: Icon Composer has a native background color picker.
The current shipping icon uses:
- light: `#F5F0E8` (sampled from `AppIcon.png` corners)
- dark:  `#1A1A1A` (sampled from `AppIcon-dark.png` corners)

## Steps

1. Open Icon Composer, start a new icon.
2. Set the background to `#F5F0E8` (Icon Composer also lets you define the dark-appearance
   background — use `#1A1A1A` to match the current dark icon).
3. Drag `foreground-flower-original.png` in as the foreground layer. Scale/center it to
   match the current icon (flower occupies roughly the middle ~46% of the 1024 canvas).
4. Tune the Liquid Glass controls (specular, refraction, translucency, shadow) on the
   flower layer by eye. The halftone texture may interact interestingly with refraction —
   judge at both home-screen size and App Store size, in light and dark appearances.
5. Save as `AppIcon.icon` and drag it into the Xcode project navigator; set the target's
   App Icon name to match. Xcode 26 composites it into the build automatically.
6. Check on a device/simulator — the glass effect is composited at render time by the
   system, so only an on-device look is representative.

## Notes

- A raster layer is fine: Icon Composer accepts PNG layers (SVG is only preferred for
  scalability). 729px on a 1024 canvas is acceptable; if a sharper source exists (the
  original design file the halftone flower came from), importing that instead is better.
- If you skip all this, iOS 26 still applies an automatic generic glass treatment to the
  existing flat `AppIcon.appiconset` — a hand-layered `.icon` just looks better (real
  depth/parallax/specular instead of a system guess).
