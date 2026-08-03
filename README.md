# Dither Clouds

Animated five-ink cloudscapes rendered in WebGL2, then quantized through a screen-space Bayer dither. The result sits somewhere between a moving sky, an editorial screen print, and a risograph.

![Dither Clouds preview](docs/dither-clouds.jpg)

The renderer builds depth from six cloud banks composited far-to-near. Distant banks sit higher, move slower, use smaller forms, and fade toward the sky color. The clouds translate across a fixed noise field instead of morphing in place, which keeps them feeling like weather rather than liquid.

## Run it

Requires Node.js 20 or newer.

```bash
git clone https://github.com/WallyMagill/dither-clouds.git
cd dither-clouds
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Press backtick (`` ` ``) or use the small controls button to open the tuning panel. It includes presets, palette controls, cloud composition, motion, print settings, and a button to copy the current configuration.

## Use the React component

Copy `components/dither-background/` into your project, then render it behind your content:

```tsx
import { DitherBackground } from '@/components/dither-background'

export function Hero() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      <DitherBackground
        config={{
          palette: ['#FAFAFA', '#BABABA', '#707070', '#333333', '#16181D'],
          bandCount: 5,
          cellSize: 2,
          ditherStrength: 0.68,
          ditherType: '8x8',
          cloudScale: 0.42,
          coverage: 0.72,
          crownDetail: 0.61,
          speed: 0.25,
        }}
      />
      <div className="relative z-10">Your content</div>
    </section>
  )
}
```

`config` is a partial `DitherConfig`; omitted fields use `DEFAULT_CONFIG`. Keep the object in state or memoize it to avoid unnecessary uniform updates. Set `paused` to render a deterministic still.

The component fails soft: when WebGL2 is unavailable, shader setup fails, or configuration is invalid, its CSS gradient fallback remains visible instead of leaving a blank canvas.

## Presets

All six included looks use five inks:

- Silver Lining — warm cloud light over a deep blue-gray sky; the default.
- Storm Front — denser slate forms with dramatic contrast.
- Blue Hour — cool, quiet twilight.
- Monochrome — a full white-through-black tonal ramp.
- Daylight — bright cloud whites over a clear cerulean sky.
- Sunset — warm cream, apricot, rose, and violet.

Presets tune form, composition, contrast, motion, and print texture together rather than changing only the palette. See [`components/dither-background/presets.ts`](components/dither-background/presets.ts) for complete configuration objects.

## How it works

- `shader.ts` draws the layered, billowed cloud banks and applies ordered dithering in device-pixel space, keeping the dot grid fixed while the sky moves beneath it.
- `renderer.ts` owns WebGL2 setup, uniform updates, animation, context recovery, and cleanup.
- `config.ts` validates palettes and normalizes renderer settings.
- `viewport.ts` caps device-pixel ratio and drawing-buffer area so large displays cannot create an unbounded framebuffer.
- `dither-background.tsx` supplies the React lifecycle, CSS fallback, pointer input, reduced-motion support, and offscreen animation suspension.

The React-free rendering surface is exported by `components/dither-background/engine.ts` for use with a raw canvas:

```ts
import { createRenderer } from './components/dither-background/engine'

const renderer = createRenderer(canvas, { speed: 0.2 })
renderer?.start()

// Later:
renderer?.setConfig({ coverage: 0.8 })
renderer?.destroy()
```

## Quality checks

```bash
npm test
npm run lint
npm run build
```

The test suite covers config validation, palette resampling, Bayer matrices, shader generation, animation gating, viewport bounds, renderer lifecycle and context recovery, and the React-free portability contract.

## License

[MIT](LICENSE) © Wally Magill.
