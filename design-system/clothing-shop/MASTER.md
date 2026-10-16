# Clothing Shop — design system

This is the verified adaptation of the installed UI UX Pro Max recommendation.
Source query: `fashion minimalism --design-system`; style: **Minimalism & Swiss Style**.
The task brief takes precedence over generated palette, font and pattern suggestions.
No feature, framework, domain or protocol change is part of this system.

## Direction
Product-first, spacious fashion storefront. Warm neutrals, charcoal primary actions,
olive accents. Administration uses the same tokens with denser forms and tables.
Retain the existing Karma Club brand asset, routes, categories and product data.
Do not add marketing claims, invented stock, reviews, discounts or unread counts.

## Tokens
Source of truth: `public/css/base.css`.

| Role | Value |
| --- | --- |
| Primary / text | #20251f |
| Accent / focus | #526246 |
| Background | #f7f7f2 |
| Surface | #ffffff |
| Muted text | #646b61 |
| Border / control border | #d8ddd3 / #858e7f |
| Success / surface | #286044 / #eaf3ed |
| Warning / surface | #805714 / #faf1df |
| Error / surface | #ad3434 / #fbeeee |
| Informational / surface | #345a78 / #ebf1f8 |

Use system sans-serif (Segoe UI, Helvetica Neue, Arial), with Vietnamese coverage
and no new remote font dependency. Body 16px/1.6; labels/buttons 14px; supporting
text 12px; headings clamp between 28px and 48px. Numbers use tabular figures.
Spacing: 4, 8, 12, 16, 24, 32, 48, 64px. Radii: 6, 12, 20px.
Content max-width 1280px; gutters clamp 16–56px.

## Components
- Primary: charcoal fill/white text. Secondary and outline: white/neutral border.
- Destructive: outlined error color with pale error hover. Preserve disabled and
  aria-busy state from existing scripts; never infer write eligibility in CSS.
- Inputs: visible labels, 48px controls, input border token, 3px focus ring.
- Product cards: 3:4 image, restrained 1.025 hover scale, readable name/price,
  wrapping tags; 2/3/4 columns across screen sizes.
- Tables: semantic headers, status text plus color, contained horizontal scrolling.
- Modal: shared scrim, bounded height, internal scroll, keyboard trap/return focus.
- Feedback: inline validation, server-owned messages, existing retry controls,
  empty states and reduced-motion-safe loading indicators.
- Chat: charcoal outgoing bubble, white incoming bubble, sender and timestamp;
  preserve socket auth, events, ACK, UUID, reconnect/resync and drafts.

## Responsive and motion
375/768/1024/1440px are verified targets. Customer nav changes at the existing
992px JS breakpoint. Admin nav becomes a compact grid at 768px.
Use 160–220ms hover/panel transitions. No parallax or decorative page animation.
Respect prefers-reduced-motion, including slider autoplay and Chart.js animation.

## Compatibility
See `docs/ui-refactor.md` for the selector audit, screen coverage and test evidence.
Keep IDs, data attributes, class hooks, field parents, table detail rows and
exact onclick selectors used by the existing scripts.
