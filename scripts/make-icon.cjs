// One-off: take the source 로고.png and make its outer (background) area
// transparent via an edge flood-fill of near-white pixels, then write build/icon.png.
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const SRC = process.argv[2]
const OUT = process.argv[3]
const png = PNG.sync.read(fs.readFileSync(SRC))
const { width: w, height: h, data } = png

const idx = (x, y) => (y * w + x) * 4
const isBg = (x, y) => {
  const i = idx(x, y)
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  const a = data[i + 3]
  if (a < 8) return true // already transparent
  // Near-white and low saturation → background.
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return mx >= 232 && mx - mn <= 16
}

const visited = new Uint8Array(w * h)
const stack = []
const seed = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return
  if (visited[y * w + x]) return
  if (!isBg(x, y)) return
  visited[y * w + x] = 1
  stack.push(x, y)
}
for (let x = 0; x < w; x++) {
  seed(x, 0)
  seed(x, h - 1)
}
for (let y = 0; y < h; y++) {
  seed(0, y)
  seed(w - 1, y)
}
while (stack.length) {
  const y = stack.pop()
  const x = stack.pop()
  data[idx(x, y) + 3] = 0 // make transparent
  seed(x + 1, y)
  seed(x - 1, y)
  seed(x, y + 1)
  seed(x, y - 1)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, PNG.sync.write(png))
const cleared = visited.reduce((n, v) => n + v, 0)
console.log(`wrote ${OUT} (${w}x${h}), cleared ${cleared} bg px`)
