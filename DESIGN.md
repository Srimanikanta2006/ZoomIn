---
name: Regulatory Clarity
colors:
  surface: '#fbf9f4'
  surface-dim: '#dbdad5'
  surface-bright: '#fbf9f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3ee'
  surface-container: '#f0eee9'
  surface-container-high: '#eae8e3'
  surface-container-highest: '#e4e2dd'
  on-surface: '#1b1c19'
  on-surface-variant: '#43474e'
  inverse-surface: '#30312e'
  inverse-on-surface: '#f2f1ec'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#465f86'
  primary: '#032448'
  on-primary: '#ffffff'
  primary-container: '#1f3a5f'
  on-primary-container: '#8ba4cf'
  inverse-primary: '#aec8f4'
  secondary: '#8c5000'
  on-secondary: '#ffffff'
  secondary-container: '#fc9923'
  on-secondary-container: '#653800'
  tertiary: '#172534'
  on-tertiary: '#ffffff'
  tertiary-container: '#2d3b4b'
  on-tertiary-container: '#96a5b8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#aec8f4'
  on-primary-fixed: '#001c3b'
  on-primary-fixed-variant: '#2d476d'
  secondary-fixed: '#ffdcbf'
  secondary-fixed-dim: '#ffb873'
  on-secondary-fixed: '#2d1600'
  on-secondary-fixed-variant: '#6a3b00'
  tertiary-fixed: '#d5e4f8'
  tertiary-fixed-dim: '#b9c8db'
  on-tertiary-fixed: '#0e1d2b'
  on-tertiary-fixed-variant: '#3a4858'
  background: '#fbf9f4'
  on-background: '#1b1c19'
  surface-variant: '#e4e2dd'
typography:
  display-lg:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Newsreader
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Newsreader
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  headline-sm:
    fontFamily: Newsreader
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  title-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2.5rem
  margin-mobile: 1rem
  space-xs: 0.5rem
  space-sm: 1rem
  space-md: 1.5rem
  space-lg: 2rem
  space-xl: 3rem
---

## Brand & Style

The design system embodies institutional gravitas, quiet authority, and precision. Built for technical education council regulators, reviewers, and compliance officers scrutinizing high-stakes institutional approval documentation, the aesthetic prioritizes cognitive ease over decorative friction.

### Architectural Tenets
- **Archival Warmth over Cold Bureaucracy:** Warm paper and archival substrate tones replace harsh digital blue-whites, reducing eye fatigue during exhaustive 8-hour document authentication sessions.
- **Editorial Legibility:** Academic, regulatory headings paired with clear, systematic utilitarian data typography. It evokes the permanence of gazetted records combined with the efficiency of modern cryptographic validation.
- **Auditable Restraint:** Color is never purely decorative. It signals verification states, legal standing, or critical non-compliance. Surfaces rely on crisp hairline boundaries rather than dramatic dropped shadows.
- **Unambiguous Microcopy:** Language is plain, decisive, and free of vague terminology or administrative jargon.

## Colors

The palette establishes an official canvas grounded in archival permanence, balanced by an authoritative navy, a focused saffron accent, and strict accessible status indicators.

### Surface and Typography System
- **Canvas / Base Substrate (`#F7F5F0`):** A warm archival parchment ground. Used as the global viewport background.
- **Surface Elevated (`#FFFFFF`):** Primary card, sheet, and modal container surface.
- **Surface Layered (`#FCFBF9`):** Subdued inner containers, table headers, document comparison panes, and nested review sections.
- **Border / Subtle Divider (`#E5E0D8`):** Crisp 1px structural boundaries defining the architectural grid.
- **Ink / On-Surface (`#0F1B2D`):** Primary high-contrast slate ink. Meets WCAG AAA compliance for body text against `#FFFFFF` and `#F7F5F0`.
- **Muted Ink (`#526071`):** Subtitles, inactive column headers, metadata labels, and structural breadcrumb dividers.

### Regulatory State Signals
Every semantic status must be rendered with an unambiguous status icon alongside readable text (never color alone):
- **Critical / Non-Compliant (`#B3261E`):** Hard rejections, forged documents, land title mismatches, failed built-up area mandates.
- **Warning / Discrepancy (`#B26A00`):** Faculty cadre ratio imbalances, impending renewal windows, borderline laboratory carpet space.
- **Info / Under Verification (`#1B6FB5`):** Cryptographic signature polling, OCR parsing in progress, pending geo-tagging validation.
- **Compliant / Verified (`#2E7D4F`):** Unbroken chain of custody, validated municipal certificates, verified AICTE norm fulfillment.

## Typography

The typographic hierarchy balances judicial prestige with systematic operational density:

- **Newsreader (Display & Headlines):** Imparts the literary, authoritative cadence of statutory gazettes, official decrees, and institutional charters. Use for top-level review view titles, institution legal designations, and major audit modal headings.
- **Inter (Interface & Data):** High-efficiency neutral grotesque engineered for rapid scannability within tabular compliance logs, approval checklists, form inputs, and system notifications.
- **JetBrains Mono (Technical Identifiers):** Used systematically for machine-verified fields: Application IDs (e.g., `APP-2025-EN-08492`), SHA-256 cryptographic document checksums, cadastral survey coordinates, land registry parcel references, and date-time audit stamps.

## Layout & Spacing

The platform is engineered desktop-first, calibrated for high-density 1440px displays used by accreditation panels, legal assessors, and regional AICTE officers.

### Layout Architecture
- **Desktop Target (1440px+):** Fixed full-height operational cockpit with a 260px collapsible institutional navigation sidebar, a central 12-column dynamic work canvas (max-width 1680px, 24px gutters, 40px outer margins), and an optional contextual 420px document split-screen validation tray.
- **Tablet Reflow (768px – 1024px):** Inspection workbench transforms to a single primary column; secondary document inspector collapses into a slide-over verification drawer.
- **Mobile Read-Only (320px – 767px):** Limited to on-site physical inspection summaries, verification checklists, and status tracking. Margins reduce to 16px, gutters to 16px.

### Baseline Spacing Scale
A strict 8px increment system governs all layout and padding tokens:
- `space-xs` (8px): Micro component spacing, icon-to-label gaps, chip inner padding.
- `space-sm` (16px): Input field interior padding, standard card interior padding, list row spacing.
- `space-md` (24px): Card block separation, grid gap between peer assessment widgets.
- `space-lg` (32px): Primary section container margins, validation category separation.
- `space-xl` (48px): Major operational zones, page header baseline separation from primary content tables.

## Elevation & Depth

Visual hierarchy is maintained through flat structural layering, tonal division, and crisp 1px borders rather than exaggerated drop shadows. The UI remains grounded, resembling physical desk work across physical records.

### Surface Tiers
- **Tier 0 (Substrate Canvas):** `#F7F5F0`. The baseline archival ground.
- **Tier 1 (Resting Sheets & Containers):** `#FFFFFF` framed by a 1px solid `#E5E0D8` stroke. Shadow is minimal: `0 1px 2px rgba(15, 27, 45, 0.04)`.
- **Tier 2 (Active Inspection Drawers & Dropdowns):** `#FFFFFF` framed by 1px solid `#E5E0D8` with focused ambient lift: `0 4px 12px rgba(15, 27, 45, 0.08)`.
- **Tier 3 (Legal Modals & Final Determination Dialogs):** `#FFFFFF` centered over a 60% opacity `#0F1B2D` backdrop overlay with ambient diffusion: `0 12px 32px rgba(15, 27, 45, 0.16)`.

## Shapes

The interface balances sharp administrative rectilinearity with human-friendly touchpoints.

- **Base Radius (8px / `rounded-md`):** Form controls, text inputs, table action buttons, and nested alert banners.
- **Card Radius (12px / `rounded-lg`):** Institutional dossier cards, document validation containers, comparison modules.
- **Pill Radius (Full / `rounded-full`):** Reserved exclusively for compliance status badges, counter indicators, and security validation tags.

## Components

### Buttons
- **Primary Action (Regulatory Approval / Final Save):** Solid `#1F3A5F` background, `#FFFFFF` text, 8px border radius, 40px height, 16px horizontal padding. Hover shifts to `#162A45`.
- **Secondary Action (Request Clarification / Export Dossier):** `#FFFFFF` surface with 1px border `#E5E0D8`, `#0F1B2D` text. Hover shifts to `#F7F5F0`.
- **Accent Action (Override / Flag for Special Scrutiny):** `#E8890C` background, `#FFFFFF` text. Used sparingly.
- **Destructive Action (Issue Defect Notice / Reject Application):** Transparent or light red background (`#FDF2F2`), `#B3261E` text, 1px solid `#F5C2C0`. Hover: `#B3261E` background, `#FFFFFF` text.

### Regulatory Status Badges
Always pair color with semantic icons and text:
- **Verified / Compliant:** `#EAF5EE` ground, `#2E7D4F` text and border. Icon: `check-circle`. Example: *"AICTE Norms Met (1:15 Cadre Ratio)"*.
- **Discrepancy / Warning:** `#FEF7ED` ground, `#B26A00` text and border. Icon: `alert-triangle`. Example: *"Shortfall: 2 Senior Professors Required"*.
- **Critical / Rejected:** `#FDF2F2` ground, `#B3261E` text and border. Icon: `x-circle`. Example: *"Cadastral Survey Mismatch: Land Unregistered"*.
- **In Review:** `#EDF5FB` ground, `#1B6FB5` text and border. Icon: `clock`. Example: *"OCR Extraction & Verification In-Progress"*.

### Data Tables (Dossier & Faculty Ledgers)
- Header: `#FCFBF9` background, 44px height, uppercase 11px JetBrains Mono labels, muted ink (`#526071`), 1px bottom border (`#E5E0D8`).
- Rows: 52px height, `#FFFFFF` background with alternating hover state `#FAF8F5`. Monospace application keys left-aligned; status chips centered; action buttons right-aligned.

### Document Split-Pane Viewer
- Left Pane: Extracted structured data fields (cadastral survey number, plot area in acres, FAR, sanctioned occupancy).
- Right Pane: 1:1 original PDF view with live bounding boxes highlighting AI-extracted text matching council requirements.

### Form Inputs
- 40px height, `#FFFFFF` surface, 1px solid `#E5E0D8`, 8px border radius.
- Active/Focus: 1px solid `#1F3A5F` with a 2px subtle outer ring (`rgba(31, 58, 95, 0.15)`).
- Error state: 1px solid `#B3261E`, accompanied by inline validation error text with an alert icon.
## PreFlight safety and language overrides

The project requirements in `AGENTS.md` take precedence over any conflicting wording in this Stitch reference. Never label a document as forged or make an automated final decision. Describe suspicious signals as an **indicator requiring human verification**. Findings must follow the shared JSON schema, and every action must be recorded in the hash-chained audit table.
