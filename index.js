import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'hacknet-bridge-skill'
export const inject = ['skills']

const skillFile = join(dirname(fileURLToPath(import.meta.url)), 'skills', 'hacknet-control.md')

/**
 * Contribute the bridge's operating instructions to the skill catalog.
 *
 * The tools themselves come from the `mcp-hacknet-bridge` row in
 * `cordis.patch.yml`, which runs HacknetPathfinderBridge.Host.exe over stdio and
 * registers `mcp__hacknet__hnpb_*`. This plugin only adds the guidance that
 * keeps an agent from driving the game with stale session epochs or treating
 * command dispatch as completion.
 */
export function apply(ctx) {
  const content = readFileSync(skillFile, 'utf8')
  ctx.skills.register({
    name: 'hacknet-control',
    description:
      'Control and test Hacknet Pathfinder gameplay through the bridge MCP tools: paused observation, terminal commands, common UI controls, and registered mod adapters.',
    whenToUse:
      'Use when the user asks to inspect, play, or test a running Hacknet instance through the hacknet MCP server. Not for real-world network operations.',
    source: 'runtime',
    content,
  })
}
