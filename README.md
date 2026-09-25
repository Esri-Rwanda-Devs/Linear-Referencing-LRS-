# Rwanda LRS Inline

Interactive linear referencing view for national roads in Rwanda. Hover a route on the map and the station cursor, grouped asset chart, and feature list move with it.

Data comes from the public services on `gh.space.gov.rw`:

- National roads, bridges, junctions, lights, culverts, signs, and bus stops: Road FeatureServer
- Water pipes and tanks: Water FeatureServer
- Provinces and districts: Admin Boundaries FeatureServer

The map viewer item `44f8c12876dc4751b3ec8c4116c4202f` requires a portal sign-in, so the app uses these open layers on the same server.

```bash
npm install
npm run dev
```
