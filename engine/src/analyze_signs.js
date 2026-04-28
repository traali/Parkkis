const fs = require("fs-extra");
const path = require("node:path");

async function analyze() {
  const signs = await fs.readJson(
    path.join(process.cwd(), ".cache/signs.json"),
  );
  const total = signs.features.length;
  const withDate = signs.features.filter(
    (f) => f.properties.ens_vo_pv && f.properties.ens_vo_pv.trim() !== "",
  ).length;
  const withModDate = signs.features.filter(
    (f) => f.properties.muokkauspv && f.properties.muokkauspv.trim() !== "",
  ).length;

  console.log(`Total Signs: ${total}`);
  console.log(`With ens_vo_pv: ${withDate}`);
  console.log(`With muokkauspv: ${withModDate}`);

  const modDates = signs.features
    .map((f) => {
      const d = f.properties.muokkauspv.split(" ")[0].split(".");
      return new Date(`${d[2]}-${d[1]}-${d[0]}`);
    })
    .filter((d) => !Number.isNaN(d.getTime()));

  const minDate = new Date(Math.min(...modDates));
  const maxDate = new Date(Math.max(...modDates));

  console.log(
    `muokkauspv Range: ${minDate.toISOString()} to ${maxDate.toISOString()}`,
  );

  const thirtyDaysAgo = new Date("2026-03-29");
  const recent = modDates.filter((d) => d >= thirtyDaysAgo).length;
  console.log(`Recent (last 30 days): ${recent}`);
}

analyze();
