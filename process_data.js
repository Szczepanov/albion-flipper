const fs = require('fs');
const path = require('path');

const itemsFile = path.join(__dirname, 'items.json');
const outputFile = path.join(__dirname, 'items_min.json');

console.log('Reading items.json (this might take a moment)...');
const data = fs.readFileSync(itemsFile, 'utf8');
const items = JSON.parse(data);

console.log(`Parsed ${items.length} items. Processing...`);

const minified = [];
const dict = {};

for (const item of items) {
  if (item.UniqueName && item.LocalizedNames && item.LocalizedNames['EN-US']) {
    // Only include items that have proper localizations
    minified.push({
      id: item.UniqueName,
      name: item.LocalizedNames['EN-US']
    });
    dict[item.UniqueName] = item.LocalizedNames['EN-US'];
  }
}

// Write the minified list (useful for search)
fs.writeFileSync(outputFile, JSON.stringify(minified, null, 2));

console.log(`Successfully extracted ${minified.length} items to items_min.json.`);

// Let's also parse the world.json for convenience
const worldFile = path.join(__dirname, 'world.json');
const worldOutFile = path.join(__dirname, 'world_min.json');
if (fs.existsSync(worldFile)) {
    const worldData = JSON.parse(fs.readFileSync(worldFile, 'utf8'));
    const worldMin = [];
    for(const loc of worldData) {
        if(loc.UniqueName) {
           worldMin.push({
               id: loc.Index,
               name: loc.UniqueName
           });
        }
    }
    fs.writeFileSync(worldOutFile, JSON.stringify(worldMin, null, 2));
    console.log(`Successfully extracted ${worldMin.length} locations to world_min.json.`);
}
