# Homepage redesign

The homepage now lives in `src/components/landing/HomeView.tsx`, with scoped styles in `src/styles/home.css`. The other public pages retain their existing routing and forms. The navigation has a narrow-screen adjustment at 360px.

## Design

- Full-width editorial cover, navy background and mint accents.
- Four photorealistic activity illustrations in keyboard-accessible tabs: business analysis, time planning, invoicing and team collaboration.
- Explicitly labelled illustrative cards, including a local interactive timer that never writes to the API.
- All twelve modules, a three-step workflow, FAQ and access/contact calls to action.
- Continuous cinematic cover zoom, staggered headline reveals, animated text highlights, drawn underline, orbiting time/mission/cash icons and a travelling connection line. A pause/resume control stops decorative motion, the hero pauses offscreen, and reduced-motion preferences disable visual animation.
- Existing client logos only; no new testimonials or customer claims.

## Cover asset

Built-in image generation was used to create `public/landing/team-cover.webp` (1536 × 1024, approximately 128 KB). The source was converted to WebP for delivery. This is an AI-generated editorial illustration; it does not depict identified customers or staff. The homepage activity section now uses the four generated photographs listed below. Product screenshots are retained for the other public pages.

## Activity images

All four images were generated with the built-in image tool and converted to WebP at 1536 × 1024. They illustrate activities, not identified customers or staff. Each prompt combines this shared prefix with its scene below:

> Use case: photorealistic-natural. Create one premium editorial business photograph for a Tunisian SaaS homepage, landscape 3:2. Authentic North African professionals, contemporary Mediterranean office, warm daylight, realistic skin and hands, navy clothing with muted teal accents, walnut and cream materials, sophisticated magazine photography, natural candid activity. No logos, no watermark, no floating UI, no legible text, no collage.

- `public/landing/activity-pilotage.webp`: Two business partners, woman and man in their 30s, reviewing printed financial charts with teal and navy bar graphs at a conference table. Three-quarter view, charts clearly visible in foreground and thoughtful people discussing strategy behind them. The image must immediately communicate business performance analysis and decision making.
- `public/landing/activity-temps.webp`: A focused female consultant working alone at a desk, using a pencil to mark a paper weekly planner with color-coded task blocks, slim laptop in the background, prominent elegant analog desk clock beside the planner. Close three-quarter editorial view of her face, planner and clock. Clearly communicate time management, concentration and task planning.
- `public/landing/activity-facturation.webp`: Close three-quarter shot of a professional accountant at a tidy desk reviewing an invoice and using a calculator. Physical paper invoice with structured rows and totals but no readable text, navy folder, pen in one hand, calculator under the other, silver laptop to one side. Emphasize invoices, calculation and organized financial paperwork in foreground; the accountant's face visible in upper third. Communicate invoicing and cash management.
- `public/landing/activity-equipe.webp`: Four diverse North African colleagues, two women and two men, in a warm modern office gathered around a table for a friendly planning meeting. One woman team lead gestures toward a large paper team calendar, others engaged listening and sharing ideas. Wide candid group composition, natural varied expressions, authentic relaxed business attire, notebooks, plant, warm daylight. Communicate team collaboration, human resources and people management.

Original cover generation prompt:

> Use case: photorealistic-natural. Asset type: premium SaaS website homepage cover photograph for Tâches & Cash, a Tunisian team, time and business management platform. Create a cinematic yet entirely realistic editorial photograph, wide landscape 3:2 composition. Two professional North African coworkers in their early 30s, woman with dark wavy hair in ivory blouse and man with short dark hair in deep navy shirt, collaborating naturally at a contemporary walnut desk in a sophisticated sunlit Mediterranean office. Woman in foreground on right side using an open slim silver laptop viewed from the back/side (screen not visible); man slightly behind her pointing to a printed business document. Candid concentrated expressions, authentic skin textures, correct natural hands. Warm sunlight from large window, white linen curtains, olive plant, soft architectural shadows, subtle teal notebook on desk. Cream, dark navy and muted turquoise palette. Frame the people in upper right two thirds, desk extends across bottom, softly blurred architecture on left, enough breathing space. Beautiful photographic depth, 50mm editorial photography, premium business magazine art direction. No text, logos, watermarks, fake interface overlays, cartoon elements, excessive lens effects or staged handshake. This will be used as a real photo cover alongside HTML UI widgets. Save the generated image as a project asset and return the local file path if available.

## Verification

- `npm run lint` (TypeScript) and `npm run build`.
- Browser checks at 320, 390, 768 and 1440 px: no horizontal document overflow.
- Visible element bounds at 320, 390 and 1440 px.
- All four preview tabs and arrow-key selection.
- Timer start, pause and reset; FAQ opening.
- Pricing/contact navigation and mobile support navigation.
- Reduced-motion rendering, image loading and JavaScript errors.
- Activity-photo update: four distinct photo URLs and successful image decoding; animated cover transforms; pause/resume freezes and restores motion; offscreen hero pauses; changing reduced-motion preference stops all running visual animations.

The existing production bundle size warning remains; the redesign adds no dependencies.
