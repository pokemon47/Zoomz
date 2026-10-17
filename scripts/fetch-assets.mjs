import { mkdir, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const photos = [
  '1600210492486-724fe5c67fb0', '1600607687939-ce8a6c25118c', '1600210491892-03d54c0aaf87', '1616486338812-3dadae4b4ace',
  '1600210491369-e753d80a41f3', '1600573472591-ee6b68d14c68', '1616486029423-aaa4789e8c9a', '1600607687920-4e2a09cf159d',
  '1600566753086-00f18fb6b3ea', '1600607688969-a5bfcd646154', '1600566753190-17f0baa2a6c3', '1618221195710-dd6b41faaea6',
  '1600566752355-35792bedcfea', '1600607687644-c7171b42498f', '1600210492493-0946911123ea', '1615874694520-474822394e73',
  '1600047509807-ba8f99d2cdde', '1600566753051-f0b89df2dd90', '1511818966892-d7d671e672a2', '1519710164239-da123dc03ef4',
  '1494438639946-1ebd1d20bf85', '1533090161767-e6ffed986c88', '1618220048045-10a6dbdf83e0', '1618220179428-22790b461013',
  '1507473885765-e6ed057f782c', '1540932239986-30128078f3c5', '1513506003901-1e6a229e2d15', '1543198126-a8ad8e47fb22',
  '1513694203232-719a280e022f', '1505693416388-ac5ce068fe85',
]

const destination = fileURLToPath(new URL('../public/images/', import.meta.url))
await mkdir(destination, { recursive: true })
let cursor = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < photos.length) {
    const index = cursor++
    const name = String(index + 1).padStart(2, '0')
    for (const [suffix, width, quality] of [['thumb', 480, 75], ['large', 1400, 82]]) {
      if (await stat(`${destination}${name}-${suffix}.jpg`).then(file => file.size > 1000).catch(() => false)) continue
      const url = `https://images.unsplash.com/photo-${photos[index]}?auto=format&fit=max&w=${width}&q=${quality}&fm=jpg`
      execFileSync('curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '60', '--silent', '--show-error', url, '--output', `${destination}${name}-${suffix}.jpg`])
    }
    process.stdout.write(`${name} photo-${photos[index]}\n`)
  }
}))
