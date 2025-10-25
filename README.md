# Blueprint Store (Custom Integration)

Browse and import Blueprints from the Home Assistant community — with search (title), tag filters, sorting, infinite scroll, inline "read more", and install/like stats.

## HACS Installation
1. Open **HACS → Integrations → ⋮ (menu) → Custom repositories**.
2. Add your GitHub repo URL for this project. Category: **Integration**.
3. Click **Install** on *Blueprint Store*.
4. Restart Home Assistant.
5. Go to **Settings → Devices & services → Add Integration** and pick **Blueprint Store**.
6. A **Blueprint Store** item will appear in the sidebar.

> Drop your branding images at:`custom_components/blueprint_store/images/bps_logo.png` and `custom_components/blueprint_store/images/bps_banner.png`.

## Notes
- Install counts are parsed best-effort from the forum's "Import to Home Assistant" badge in each topic (if present).- External forum links open via a local redirect endpoint to avoid iframe/CSP issues.

MIT License.
