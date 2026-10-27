import { cn } from 'cn'
import { ArrowUpIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { events } from '../sdk/events.ts'
import { useConversation } from '../sdk/hooks.ts'
import { column } from './layout.ts'

type Turn = { entryId: number; phrase: string }

/** The user turn the top row on screen answers, unless that turn is itself on screen. */
function turnAbove(scroll: HTMLElement, content: HTMLElement): Turn | undefined {
  const top = scroll.getBoundingClientRect().top
  const rows = [...content.querySelectorAll(':scope > [data-entry-id]')]
  const first = rows.findIndex((row) => row.getBoundingClientRect().bottom > top)
  if (first < 0 || rows[first].querySelector('[data-turn-phrase]')) return undefined
  for (let index = first - 1; index >= 0; index--) {
    const phrase = rows[index].querySelector('[data-turn-phrase]')
    if (phrase)
      return {
        entryId: Number(rows[index].getAttribute('data-entry-id')),
        phrase: phrase.getAttribute('data-turn-phrase')!,
      }
  }
  return undefined
}

/** While the reader is scrolled up, a line at the top names the user turn being answered; a click goes back to it. */
export function PinnedUserTurn({ dock }: { dock?: boolean }) {
  const { isAtBottom, scrollRef, contentRef } = useStickToBottomContext()
  const id = useConversation((conversation) => conversation.id)
  const [turn, setTurn] = useState<Turn>()
  useEffect(() => {
    const scroll = scrollRef.current
    if (isAtBottom || !scroll) return undefined
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setTurn(contentRef.current ? turnAbove(scroll, contentRef.current) : undefined),
      )
    }
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroll.removeEventListener('scroll', update)
    }
  }, [isAtBottom, scrollRef, contentRef])
  if (isAtBottom || !turn) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
      <div className={cn(column(dock), 'pt-1.5')}>
        <button
          className="pointer-events-auto flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-background/90 px-2.5 py-1 text-left text-xs text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground"
          data-pinned-turn={turn.entryId}
          onClick={() =>
            events.emit('ultimate:reveal-entry', { conversationId: id, entryId: turn.entryId })
          }
          title="Scroll to this message"
          type="button"
        >
          <ArrowUpIcon className="size-3 shrink-0" />
          <span className="truncate">{turn.phrase}</span>
        </button>
      </div>
    </div>
  )
}
