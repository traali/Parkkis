# Parkkis UI components

Status: **component catalog 2026-09-26**. Every visual file under `web/src/components/`. The screen is `web/src/App.tsx`. There is no router.

Live: https://parkkis.pages.dev
Job: Helsinki parking map. Risk, fines, signs, roadworks, reservations. Not a sports card.

`web/src/lib/helsinkiCaseParser.tsx` is a HEL-diary parser, not a component. It does not render.

## Screen (`web/src/App.tsx`)

| Element | Why |
|---|---|
| Address search | Placeholder `Mannerheimintie 1`. Moves the map |
| Theme: Night Captain, Day Patrol, Nordic Forest | Contrast only. No data |
| Category chips | Filter the layer set |
| TICKET HOTSPOTS | Historical fine clusters |
| FINE LOCATIONS | Individual fines |
| PARKING SIGNS | Signs beat a painted bay. The HUD says Signs Override Map |
| CONSTRUCTION | Roadworks on top of a bay |
| RESERVATIONS | Reserved bays |
| LIST VIEW | Opens `ReservationsDrawer` |
| Loading line | Shown until the local database is ready |
| 165.7k Tickets Mapped | Scale of the fine set. Not a live count |

## Components

| File | Mounted by | What the parent sees | Why |
|---|---|---|---|
| `ParkingMapView.tsx` | `App.tsx` | MapLibre map | The product. Layers are toggled from the HUD, not from inside the map |
| `ParkingPopup.tsx` | Map, and hover in App | Capacity, Facility ID, Public Hub, From, Until | One bay. Missing capacity must say Capacity not specified |
| `ReservationsDrawer.tsx` | App, LIST VIEW | Sort by, list, or No reservations found | The list is not a second map |
| `MetadataCatalogueModal.tsx` | App info panel | Field, registry value, WFS layer name, dataset purpose | So a parent can see where a number came from |

## What not to "improve"

- Do not turn this into a match card.
- Do not hide the sign layer under the risk paint. Signs override the map.
- Do not invent a free bay when the feed has no capacity.
