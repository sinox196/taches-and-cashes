# Homepage redesign

The homepage now lives in `src/components/landing/HomeView.tsx`, with scoped styles in `src/styles/home.css`. The other public pages retain their existing routing and forms. The navigation has a narrow-screen adjustment at 360px.

## Design

- Full-width editorial cover, navy background and mint accents.
- Actual product screenshots in four keyboard-accessible tabs.
- Explicitly labelled illustrative cards, including a local interactive timer that never writes to the API.
- All twelve modules, a three-step workflow, FAQ and access/contact calls to action.
- Entry and scroll animations, tab transitions and hover feedback; reduced-motion preferences stop visual animation.
- Existing client logos only; no new testimonials or customer claims.

## Cover asset

Built-in image generation was used to create `public/landing/team-cover.webp` (1536 × 1024, approximately 128 KB). The source was converted to WebP for delivery. This is an AI-generated editorial illustration; it does not depict identified customers or staff. Product screenshots remain the existing `/support/*.webp` assets.

Generation prompt:

> Use case: photorealistic-natural. Asset type: premium SaaS website homepage cover photograph for Tâches & Cash, a Tunisian team, time and business management platform. Create a cinematic yet entirely realistic editorial photograph, wide landscape 3:2 composition. Two professional North African coworkers in their early 30s, woman with dark wavy hair in ivory blouse and man with short dark hair in deep navy shirt, collaborating naturally at a contemporary walnut desk in a sophisticated sunlit Mediterranean office. Woman in foreground on right side using an open slim silver laptop viewed from the back/side (screen not visible); man slightly behind her pointing to a printed business document. Candid concentrated expressions, authentic skin textures, correct natural hands. Warm sunlight from large window, white linen curtains, olive plant, soft architectural shadows, subtle teal notebook on desk. Cream, dark navy and muted turquoise palette. Frame the people in upper right two thirds, desk extends across bottom, softly blurred architecture on left, enough breathing space. Beautiful photographic depth, 50mm editorial photography, premium business magazine art direction. No text, logos, watermarks, fake interface overlays, cartoon elements, excessive lens effects or staged handshake. This will be used as a real photo cover alongside HTML UI widgets. Save the generated image as a project asset and return the local file path if available.

## Verification

- `npm run lint` (TypeScript) and `npm run build`.
- Browser checks at 320, 390, 768 and 1440 px: no horizontal document overflow.
- Visible element bounds at 320, 390 and 1440 px.
- All four preview tabs and arrow-key selection.
- Timer start, pause and reset; FAQ opening.
- Pricing/contact navigation and mobile support navigation.
- Reduced-motion rendering, image loading and JavaScript errors.

The existing production bundle size warning remains; the redesign adds no dependencies.
