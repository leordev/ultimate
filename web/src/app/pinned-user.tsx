import { cn } from 'cn'
import { ArrowUpIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { Shimmer } from '@/components/ai/shimmer'
import { events } from '../sdk/events.ts'
import { useConversation } from '../sdk/hooks.ts'
import { column } from './layout.ts'

/** The user turn to pin, or `earlier` while it sits in history not loaded yet. */
type Turn = { entryId: number; phrase: string } | 'earlier'

/** The user turn the top row on screen answers, unless the start of that turn is itself on screen. */
function turnAbove(scroll: HTMLElement, content: HTMLElement): Turn | undefined {
  const top = scroll.getBoundingClientRect().top
  const rows = [...content.querySelectorAll(':scope > [data-entry-id]')]
  const first = rows.findIndex((row) => row.getBoundingClientRect().bottom > top)
  if (first < 0) return undefined
  for (let index = first; index >= 0; index--) {
    const phrase = rows[index].querySelector('[data-turn-phrase]')
    if (!phrase) continue
    if (index === first && rows[index].getBoundingClientRect().top >= top) return undefined
    return {
      entryId: Number(rows[index].getAttribute('data-entry-id')),
      phrase: phrase.getAttribute('data-turn-phrase')!,
    }
  }
  return content.querySelector(':scope > [data-earlier-history]') ? 'earlier' : undefined
}

/** While the reader is scrolled up, a line at the top names the user turn being answered; a click goes back to it. */
export function PinnedUserTurn({ dock }: { dock?: boolean }) {
  const { isAtBottom, scrollRef, contentRef } = useStickToBottomContext()
  const id = useConversation((conversation) => conversation.id)
  const [turn, setTurn] = useState<Turn>()
  useEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (isAtBottom || !scroll || !content) return undefined
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const found = turnAbove(scroll, content)
        setTurn(found)
        if (found === 'earlier') events.emit('ultimate:load-earlier', { conversationId: id })
      })
    }
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    // A page of earlier history grows the content without a scroll.
    const resize = new ResizeObserver(update)
    resize.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      scroll.removeEventListener('scroll', update)
      resize.disconnect()
    }
  }, [isAtBottom, scrollRef, contentRef, id])
  if (isAtBottom || !turn) return null
  return (
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
  )
}
