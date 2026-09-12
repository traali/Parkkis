# ParkkiS — 5-point test spec

1. **User Journey:** Parent taps parking on a venue and gets disc/zone + walk minutes.
2. **Reason it exists:** €80 fines and late arrivals with gear bags.
3. **What it tests:** `ParkingRiskContract` risk 1–10, walk < 1500m for arena presets.
4. **When it succeeds:** Contract fields present; live page title is ParkkiS.
5. **When it should fail:** riskRating outside 1–10; missing deepLinkUrl; title "web".
