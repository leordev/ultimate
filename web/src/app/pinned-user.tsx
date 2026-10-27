import type { EntryRecord } from '@earendil-works/pi-durable'
import { cn } from 'cn'
import { ArrowUpIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { Shimmer } from '@/components/ai/shimmer'
import { api } from '../sdk/client.ts'
import { events } from '../sdk/events.ts'
import { useConversation } from '../sdk/hooks.ts'
import { column } from './layout.ts'

type Turn = { entryId: number; phrase: string }
/** The newest user turn below `before`, `null` when there is none. */
type Found = { before: number; turn: Turn | null }
/** A page of inputs below `before` being read for a user turn, and the cursor of the page after it. */
type Lookup = { before: number; entries: EntryRecord[]; next?: number }

/** The turn of the first row holding one, newest first, among `rows`. */
function firstTurn(rows: Element[]): Turn | undefined {
  for (const row of rows) {
    const phrase = row.querySelector('[data-turn-phrase]')?.getAttribute('data-turn-phrase')
    if (phrase) return { entryId: Number(row.getAttribute('data-entry-id')), phrase }
  }
  return undefined
}

/**
 * The user turn the top row on screen answers, unless the start of that turn is itself on screen. Without one loaded
 * above, the oldest loaded entry, below which the stored history holds it.
 */
function turnAbove(scroll: HTMLElement, content: HTMLElement): Turn | number | undefined {
  const top = scroll.getBoundingClientRect().top
  const rows = [...content.querySelectorAll(':scope > [data-entry-id]')]
  const first = rows.findIndex((row) => row.getBoundingClientRect().bottom > top)
  if (first < 0) return undefined
  const turn = firstTurn(rows.slice(0, first + 1).toReversed())
  if (turn?.entryId === Number(rows[first].getAttribute('data-entry-id')))
    return rows[first].getBoundingClientRect().top >= top ? undefined : turn
  if (turn || !content.querySelector(':scope > [data-earlier-history]')) return turn
  return Math.min(
    ...[...content.querySelectorAll('[data-entry-id]')].map((row) =>
      Number(row.getAttribute('data-entry-id')),
    ),
  )
}

/**
 * While the reader is scrolled up, a line at the top names the user turn being answered; a click goes back to it. A turn
 * below the loaded history is found from the stored inputs alone, rendered unseen like their rows to read their phrase.
 */
export function PinnedUserTurn({
  dock,
  Entry,
}: {
  dock?: boolean
  Entry: ComponentType<{ entry: EntryRecord }>
}) {
  const { isAtBottom, scrollRef, contentRef } = useStickToBottomContext()
  const id = useConversation((conversation) => conversation.id)
  const [shown, setShown] = useState<Turn | 'earlier'>()
  const [lookup, setLookup] = useState<Lookup>()
  const [found, setFound] = useState<Found>()
  const probe = useRef<HTMLDivElement>(null)
  const read = useEffectEvent((before: number, from = before) => {
    api.inputs(id!, from).then(
      (page) => setLookup({ before, entries: page.entries, next: page.before }),
      () => setFound({ before, turn: null }),
    )
  })
  useLayoutEffect(() => {
    if (!lookup) return
    const turn = firstTurn([...(probe.current?.children ?? [])])
    if (!turn && lookup.next !== undefined) {
      read(lookup.before, lookup.next)
      return
    }
    setLookup(undefined)
    setFound({ before: lookup.before, turn: turn ?? null })
  }, [lookup])
  useEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (isAtBottom || !scroll || !content || id === undefined) return undefined
    let frame = 0
    let asked: number | undefined
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const above = turnAbove(scroll, content)
        if (typeof above !== 'number') return setShown(above)
        // The turn found below an older `before` is the one below `above` too, unless it is loaded by now.
        const turn = found && above <= found.before ? found.turn : undefined
        if (turn !== undefined && (turn === null || turn.entryId < above))
          return setShown(turn ?? undefined)
        setShown('earlier')
        if (asked === undefined) read((asked = above))
      })
    }
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    const resize = new ResizeObserver(update)
    resize.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      scroll.removeEventListener('scroll', update)
      resize.disconnect()
    }
  }, [isAtBottom, scrollRef, contentRef, id, found])
  const turn = isAtBottom ? undefined : shown
  return (
    <>
      {lookup && (
        <div hidden ref={probe}>
          {lookup.entries.map((entry) => (
            <div data-entry-id={entry.id} key={entry.id}>
              <Entry entry={entry} />
            </div>
          ))}
        </div>
      )}
      {turn && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
          <div className={cn(column(dock), 'pt-1.5')}>
            <button
              className="pointer-events-auto flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-background/90 px-2.5 py-1 text-left text-xs text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground disabled:cursor-default"
              data-pinned-turn={turn === 'earlier' ? 'earlier' : turn.entryId}
              disabled={turn === 'earlier'}
              onClick={() =>
                turn !== 'earlier' &&
                events.emit('ultimate:reveal-entry', { conversationId: id, entryId: turn.entryId })
              }
              title="Scroll to this message"
              type="button"
            >
              <ArrowUpIcon className="size-3 shrink-0" />
              {turn === 'earlier' ? (
                <Shimmer className="truncate">loading your message…</Shimmer>
              ) : (
                <span className="truncate">{turn.phrase}</span>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
