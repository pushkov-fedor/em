import _ from 'lodash'
import { Child, Context, Lexeme, Parent, Path } from '../types'
import { State } from './initialState'
import { EM_TOKEN, ROOT_TOKEN } from '../constants'
import { getRankAfter, getThought, getThoughts, nextSibling } from '../selectors'

// util
import {
  addThought,
  contextOf,
  createId,
  equalPath,
  equalThoughtRanked,
  hashContext,
  hashThought,
  head,
  headRank,
  pathToContext,
  removeContext,
  rootedContextOf,
  timestamp,
} from '../util'
import { Block } from '../action-creators/importText'
import { GenericObject } from '../utilTypes'

interface ImportHtmlOptions {
  skipRoot? : boolean,
}
/** Replace head block with its children, or drop it, if head has no children. */
const skipRootThought = (blocks: Block[]) => {
  const head = _.head(blocks)
  if (!head) return blocks
  const tail = _.tail(blocks)
  return head.children.length > 0 ? [...head.children, ...tail] : tail
}

/** Calculate last thought of the first level, as this is where the selection will be restored to. */
const calculateLastThoughtFirstLevel = (rankIncrement: number, rankStart: number, blocks: Block[]) => {
  const lastThoughtFirstLevelIndex = blocks.length - 1
  const lastThoughtFirstLevel = blocks[lastThoughtFirstLevelIndex]
  const rank = lastThoughtFirstLevelIndex * rankIncrement + rankStart
  return { value: lastThoughtFirstLevel.scope, rank }
}

/** Recursively iterate through blocks and call insertThought for each block individually to save it. */
const saveThoughts = (context: Context, blocks: Block[], insertThought: (value: string, context: Context, rank: number) => void, rankIncrement = 1, startRank = 0) => {
  blocks.forEach((block, index) => {
    const rank = startRank + index * rankIncrement
    insertThought(block.scope, context, rank)
    if (block.children.length > 0) {
      saveThoughts([...context, block.scope], block.children, insertThought)
    }
  })
}

/** Return number of contexts in blocks array. */
const getContextsNum = (blocks: Block[]): number => {
  return blocks
    .map(thought => thought.children.length > 0
      ? 1 + getContextsNum(thought.children)
      : 1
    )
    .reduce((acc, val) => acc + val, 0)
}

/** Calculate rankIncrement value based on rank of next sibling or its absence. */
const getRankIncrement = (state: State, blocks: Block[], context: Context, destThought: Child, rankStart: number) => {
  const destValue = destThought.value
  const destRank = destThought.rank
  const next = nextSibling(state, destValue, context, destRank) // paste after last child of current thought
  const rankIncrement = next ? (next.rank - rankStart) / (getContextsNum(blocks) || 1) : 1 // prevent divide by zero
  return rankIncrement
}

/** Return start context for saving thoughts. */
const getStartContext = (thoughtsRanked: Path) => {
  const importCursor = equalPath(thoughtsRanked, [{ value: EM_TOKEN, rank: 0 }])
    ? thoughtsRanked
    : contextOf(thoughtsRanked)
  return pathToContext(importCursor)
}

/** Convert JSON blocks to thoughts update. */
export const importJSON = (state: State, thoughtsRanked: Path, blocks: Block[], { skipRoot = false }: ImportHtmlOptions) => {
  const thoughtIndexUpdates: GenericObject<Lexeme> = {}
  const contextIndexUpdates: GenericObject<Parent> = {}
  const context = pathToContext(contextOf(thoughtsRanked))
  const destThought = head(thoughtsRanked)
  const destEmpty = destThought.value === '' && getThoughts(state, pathToContext(thoughtsRanked)).length === 0
  const thoughtIndex = { ...state.thoughts.thoughtIndex }
  const rankStart = getRankAfter(state, thoughtsRanked)
  const rankIncrement = getRankIncrement(state, blocks, context, destThought, rankStart)

  // if the thought where we are pasting is empty, replace it instead of adding to it
  if (destEmpty) {
    const thought = getThought(state, '')
    if (thought && thought.contexts && thought.contexts.length > 1) {
      thoughtIndexUpdates[hashThought('')] = removeContext(thought, context, headRank(thoughtsRanked))
      const rootedContext = pathToContext(rootedContextOf(thoughtsRanked))
      const contextEncoded = hashContext(rootedContext)
      contextIndexUpdates[contextEncoded] = {
        ...contextIndexUpdates[contextEncoded],
        children: getThoughts(state, rootedContext)
          .filter(child => !equalThoughtRanked(child, destThought)),
        lastUpdated: timestamp(),
      }
    }
  }

  /** Insert the given value at the context. Modifies contextIndex and thoughtIndex. */
  const insertThought = (value: string, context: Context, rank: number) => {
    value = value.trim()
    const id = createId()
    const rootContext = context.length > 0 ? context : [ROOT_TOKEN]
    const thoughtNew = addThought(
      {
        thoughts: {
          thoughtIndex
        }
      },
      value,
      rank,
      id,
      rootContext
    )

    const hash = hashThought(value)
    thoughtIndex[hash] = thoughtNew
    thoughtIndexUpdates[hash] = thoughtNew

    // update contextIndexUpdates
    const contextEncoded = hashContext(rootContext)
    const childrenUpdates = contextIndexUpdates[contextEncoded] ? contextIndexUpdates[contextEncoded].children : []
    contextIndexUpdates[contextEncoded] = {
      ...contextIndexUpdates[contextEncoded],
      children: [...childrenUpdates, {
        value,
        rank,
        id,
        lastUpdated: timestamp(),
      }],
      lastUpdated: timestamp(),
    }
  }

  const startContext = getStartContext(thoughtsRanked)
  const thoughts = skipRoot ? skipRootThought(blocks) : blocks
  const lastThoughtFirstLevel = calculateLastThoughtFirstLevel(rankIncrement, rankStart, thoughts)
  saveThoughts(startContext, thoughts, insertThought, rankIncrement, rankStart)
  return {
    contextIndexUpdates,
    lastThoughtFirstLevel,
    thoughtIndexUpdates,
  }
}
