'use strict';

const fs = require('node:fs');
const path = require('node:path');

function comparable(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function resolveDownloadedFile(input = {}) {
  const requested = String(input.filePath || '').replace(/^['"]|['"]$/g, '').replace(/[\r\n]/g, '').trim();
  if (requested && fs.existsSync(requested) && fs.statSync(requested).isFile()) return requested;

  const expectedStem = comparable(requested ? path.parse(requested).name : '');
  const title = comparable(input.title);
  const directories = [input.destination, input.fallbackDestination, requested ? path.dirname(requested) : '']
    .map(value => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .filter(value => fs.existsSync(value) && fs.statSync(value).isDirectory());

  const files = directories.flatMap(destination => fs.readdirSync(destination, { withFileTypes: true })
    .filter(entry => entry.isFile() && !/\.(?:part|ytdl)$/i.test(entry.name))
    .map(entry => {
      const fullPath = path.join(destination, entry.name);
      return { fullPath, stem: comparable(path.parse(entry.name).name), modified: fs.statSync(fullPath).mtimeMs };
    }));

  const exactStem = files.find(file => expectedStem && file.stem === expectedStem);
  if (exactStem) return exactStem.fullPath;

  const titleMatch = files
    .filter(file => title && (file.stem.startsWith(title) || title.startsWith(file.stem) || file.stem.includes(title.slice(0, Math.min(80, title.length)))))
    .sort((a, b) => b.modified - a.modified)[0];
  return titleMatch?.fullPath || null;
}

module.exports = { resolveDownloadedFile };
