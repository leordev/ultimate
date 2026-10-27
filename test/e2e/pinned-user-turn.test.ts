// Scrolls up through a long answer in a real browser: a line at the top names the user turn it answers, cut to its
// first phrase, and a click on it scrolls back to that turn.
import { join, resolve } from 'node:path'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import type { ConversationId } from '@earendil-works/pi-durable'
import { chromium } from 'playwright-core'
import { afterEach, expect, it } from 'vitest'
import { browserBinary } from '../../extensions/browser/server.ts'
import { context } from '../../server/harness.ts'
import { fauxServer, post, removeTemp, temp } from '../helpers.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close()
})

const answer = (topic: string) =>
  Array.from({ length: 40 }, (_, index) => `${topic} paragraph ${index + 1}.`).join('\n\n')

it('pins the answered user turn while scrolled up and reveals it on click', async () => {
  const home = await temp('ultimate-pinned-turn-')
  cleanup.push(() => removeTemp(home))
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot: resolve('.'),
    userHome: home,
    home: join(home, 'state'),
    port: 0,
  })
  cleanup.push(() => server.close())
  server.host.faux!.setResponses([
    fauxAssistantMessage(answer('Alpha')),
    fauxAssistantMessage(answer('Beta')),
  ])
  const { data } = await post(server, '/api/extensions/subagents/actions/standing', {
    args: { name: 'ultimate' },
  })
  const ultimate = data.result as ConversationId
  const conversation = (await server.harness.conversation(ultimate, context))!
  for (const content of [
    'Explain alpha first. Then everything else about it.',
    'Now explain beta. And the rest.',
  ])
    await (await conversation.submit({ type: 'input', content }, context)).wait(context)

  const browser = await chromium.launch({
    executablePath: await browserBinary(),
    headless: true,
    env: { ...process.env, TMPDIR: undefined },
  })
  cleanup.push(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${server.url}/?conversation=${ultimate}`)
  const log = page.getByRole('log')
  await log.getByText('Beta paragraph 40.').waitFor()
  const pinned = page.locator('[data-pinned-turn]')
  expect(await pinned.count()).toBe(0)

  // Scroll so the middle of the beta answer is at the top: the line names the beta turn.
  await log.getByText('Beta paragraph 20.', { exact: true }).evaluate((node) => {
    node.scrollIntoView({ block: 'start' })
  })
  await pinned.waitFor()
  expect(await pinned.textContent()).toBe('Now explain beta…')
  // Visible, not covered: the element at its centre is the line itself.
  expect(
    await pinned.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    }),
  ).toBe(true)

  // Further up, inside the alpha answer, it follows.
  await log.getByText('Alpha paragraph 20.', { exact: true }).evaluate((node) => {
    node.scrollIntoView({ block: 'start' })
  })
  await page.waitForFunction(
    () => document.querySelector('[data-pinned-turn]')?.textContent === 'Explain alpha first…',
  )

  // A click scrolls back to the alpha turn, which then hides the line.
  await pinned.click()
  const turn = log.getByText('Explain alpha first. Then everything else about it.')
  await page.waitForFunction(() => !document.querySelector('[data-pinned-turn]'))
  expect(await turn.isVisible()).toBe(true)
  const top = await turn.evaluate((node) => node.getBoundingClientRect().top)
  const view = await log.evaluate((node) => node.getBoundingClientRect())
  expect(top).toBeGreaterThanOrEqual(view.top)
  expect(top).toBeLessThan(view.bottom)
})

it('names a turn below the loaded history without loading the rows between', async () => {
  const home = await temp('ultimate-pinned-long-')
  cleanup.push(() => removeTemp(home))
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot: resolve('.'),
    userHome: home,
    home: join(home, 'state'),
    port: 0,
  })
  cleanup.push(() => server.close())
  server.host.faux!.setResponses([fauxAssistantMessage('Done.')])
  const { data } = await post(server, '/api/extensions/subagents/actions/standing', {
    args: { name: 'ultimate' },
  })
  const ultimate = data.result as ConversationId
  const conversation = (await server.harness.conversation(ultimate, context))!
  await (
    await conversation.submit(
      { type: 'input', content: 'Start the long job. Report when done.' },
      context,
    )
  ).wait(context)
  // A branch's long run: 2,000 answers without a turn of the user's, dozens of history pages below what first loads.
  await server.harness.commit(async (tx) => {
    for (let index = 1; index <= 2000; index++)
      await tx.appendEntry(ultimate, {
        kind: 'pi.assistant',
        model: [fauxAssistantMessage(`Progress ${index}.`)],
      })
  }, context)

  const browser = await chromium.launch({
    executablePath: await browserBinary(),
    headless: true,
    env: { ...process.env, TMPDIR: undefined },
  })
  cleanup.push(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${server.url}/?conversation=${ultimate}`)
  const log = page.getByRole('log')
  await log.getByText('Progress 2000.', { exact: true }).waitFor()
  const history: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/history?')) history.push(new URL(request.url()).search)
  })
  // From the middle of the loaded rows, in one step, record the line on every frame until it names the turn.
  const missing = await page.evaluate(async () => {
    const scroll = document.querySelector('[role=log]')!.firstElementChild!
    scroll.scrollTop = scroll.scrollHeight / 2
    let gone = 0
    for (let frame = 0; frame < 600; frame++) {
      await new Promise(requestAnimationFrame)
      const line = document.querySelector('[data-pinned-turn]')
      if (frame > 2 && !line) gone++
      if (line?.textContent === 'Start the long job…') return gone
    }
    return -1
  })
  expect(missing).toBe(0)
  // One request for the stored inputs, not a page of history per 64 answers.
  expect(history).toHaveLength(1)
  expect(history[0]).toContain('inputs=1')

  // A click loads the history down to the turn and scrolls to it.
  await page.locator('[data-pinned-turn]').click()
  const turn = log.getByText('Start the long job. Report when done.')
  await turn.waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-pinned-turn]'))
  expect(await turn.isVisible()).toBe(true)
})
