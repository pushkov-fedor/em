import React, { useState } from 'react'
import { connect } from 'react-redux'
import classNames from 'classnames'
import assert from 'assert'
import evaluate from 'static-eval'
import { DropTarget, DropTargetConnector, DropTargetMonitor } from 'react-dnd'
import { store } from '../store'
import { isMobile } from '../browser'
import { formatKeyboardShortcut, shortcutById } from '../shortcuts'
import globals from '../globals'
import { MAX_DEPTH, MAX_DISTANCE_FROM_CURSOR, RANKED_ROOT } from '../constants'
import { alert } from '../action-creators'
import Thought from './Thought'
import GestureDiagram from './GestureDiagram'
import { Child, GesturePath, Path } from '../types'
import { State } from '../util/initialState'
import * as esprima from 'esprima'

// util
import {
  checkIfPathShareSubcontext,
  contextOf,
  ellipsize,
  equalArrays,
  equalPath,
  equalThoughtRanked,
  hashContext,
  head,
  headValue,
  isDivider,
  isEM,
  isFunction,
  isRoot,
  parseJsonSafe,
  pathToContext,
  rankThoughtsSequential,
  rootedContextOf,
  subsetThoughts,
  sumSubthoughtsLength,
  unroot,
} from '../util'

// selectors
import {
  attribute,
  attributeEquals,
  chain,
  getChildPath,
  getContextsSortedAndRanked,
  getNextRank,
  getSetting,
  getStyle,
  getThought,
  getThoughts,
  getThoughtsRanked,
  getThoughtsSorted,
  isChildVisible,
  isContextViewActive,
} from '../selectors'

/** The type of the exported Subthoughts. */
interface SubthoughtsProps {
  allowSingleContext?: boolean,
  allowSingleContextParent?: boolean,
  childrenForced?: Child[],
  contextChain?: Child[][],
  count?: number,
  depth?: number,
  expandable?: boolean,
  isParentHovering?: boolean,
  showContexts?: boolean,
  sort?: string,
  thoughtsRanked: Path,
}

/** The type of the internal SubthoughtsComponent (returned by mapStateToProps). */
type SubthoughtsComponentProps = SubthoughtsProps & {
  contextBinding?: Path,
  dropTarget: (el: JSX.Element) => any,
  isDragInProgress?: boolean,
  isEditingAncestor?: boolean,
  isHovering?: boolean,
  showHiddenThoughts?: boolean,
}

// assert shortcuts at load time
const subthoughtShortcut = shortcutById('newSubthought')
const toggleContextViewShortcut = shortcutById('toggleContextView')
assert(subthoughtShortcut)
assert(toggleContextViewShortcut)

const PAGINATION_SIZE = 100

/********************************************************************
 * mapStateToProps
 ********************************************************************/

// eslint-disable-next-line jsdoc/require-jsdoc
const mapStateToProps = (state: State, props: SubthoughtsProps) => {

  const {
    cursor,
    cursorBeforeEdit,
    dataNonce,
    showHiddenThoughts,
  } = state

  // resolve thoughts that are part of a context chain (i.e. some parts of thoughts expanded in context view) to match against cursor subset
  const thoughtsResolved = props.contextChain && props.contextChain.length > 0
    ? chain(state, props.contextChain, props.thoughtsRanked)
    : unroot(props.thoughtsRanked)

  // check if the cursor path includes the current thought
  // include ROOT to prevent re-render when ROOT subthought changes
  const isEditingPath = isRoot(props.thoughtsRanked) || subsetThoughts(cursorBeforeEdit, thoughtsResolved)

  // check if the cursor is editing an thought directly
  const isEditing = equalPath(cursorBeforeEdit, thoughtsResolved)

  const thoughtsResolvedLive = isEditing ? cursor! : thoughtsResolved
  const thoughtsLive = pathToContext(thoughtsResolvedLive)
  const showContexts = props.showContexts || isContextViewActive(state, thoughtsLive)
  const showContextsParent = isContextViewActive(state, contextOf(thoughtsLive))
  const thoughtsRanked = showContexts && showContextsParent
    ? contextOf(props.thoughtsRanked)
    : props.thoughtsRanked

  // use live thoughts if editing
  // if editing, replace the head with the live value from the cursor
  const thoughtsRankedLive = isEditing && (props.contextChain ?? []).length === 0
    ? contextOf(props.thoughtsRanked).concat(head(cursor!))
    : thoughtsRanked

  const contextBinding = parseJsonSafe(attribute(state, thoughtsRankedLive, '=bindContext') ?? '', undefined) as Path

  return {
    contextBinding,
    dataNonce,
    isEditingAncestor: isEditingPath && !isEditing,
    showContexts,
    showHiddenThoughts,
    thoughtsRanked: thoughtsRankedLive,
    // re-render if children change (unless editing)
    __render: !isEditing && !isEditingPath && getThoughts(state, pathToContext(thoughtsRankedLive))
  }
}

/********************************************************************
 * Drag and Drop
 ********************************************************************/

/** Returns true if a thought can be dropped in this context. Dropping at end of list requires different logic since the default drop moves the dragged thought before the drop target. */
const canDrop = (props: SubthoughtsProps, monitor: DropTargetMonitor) => {

  const { thoughtsRanked: thoughtsFrom } = monitor.getItem()
  const thoughtsTo = props.thoughtsRanked
  const cursor = store.getState().cursor
  const distance = cursor ? cursor.length - thoughtsTo.length : 0
  const isHidden = distance >= 2
  // there is no self thought to check since this is <Subthoughts>
  const isDescendant = subsetThoughts(thoughtsTo, thoughtsFrom)
  const divider = isDivider(headValue(thoughtsTo))

  // do not drop on descendants or thoughts hidden by autofocus
  return !isHidden && !isDescendant && !divider
}

// eslint-disable-next-line jsdoc/require-jsdoc
const drop = (props: SubthoughtsProps, monitor: DropTargetMonitor) => {

  const state = store.getState()

  // no bubbling
  if (monitor.didDrop() || !monitor.isOver({ shallow: true })) return

  const { thoughtsRanked: thoughtsFrom } = monitor.getItem()
  const thoughtsTo = props.thoughtsRanked

  const newPath = unroot(thoughtsTo).concat({
    value: headValue(thoughtsFrom),
    rank: getNextRank(state, pathToContext(thoughtsTo))
  })

  const isRootOrEM = isRoot(thoughtsFrom) || isEM(thoughtsFrom)
  const oldContext = rootedContextOf(pathToContext(thoughtsFrom))
  const newContext = rootedContextOf(pathToContext(newPath))
  const sameContext = equalArrays(oldContext, newContext)

  // cannot drop on itself
  if (equalPath(thoughtsFrom, newPath)) return

  // cannot move root or em context or target is divider
  if (isDivider(headValue(thoughtsTo)) || (isRootOrEM && !sameContext)) {
    store.dispatch({ type: 'error', value: `Cannot move the ${isEM(thoughtsFrom) ? 'em' : 'home'} context to another context.` })
    return
  }

  store.dispatch(props.showContexts
    ? {
      type: 'newThoughtSubmit',
      value: headValue(thoughtsTo),
      context: pathToContext(thoughtsFrom),
      rank: getNextRank(state, thoughtsFrom)
    }
    : {
      type: 'existingThoughtMove',
      oldPath: thoughtsFrom,
      newPath
    }
  )

  // alert user of move to another context
  if (!sameContext) {

    // wait until after MultiGesture has cleared the error so this alert does no get cleared
    setTimeout(() => {
      const alertFrom = '"' + ellipsize(headValue(thoughtsFrom)) + '"'
      const alertTo = isRoot(newContext)
        ? 'home'
        : '"' + ellipsize(headValue(thoughtsTo)) + '"'

      store.dispatch(alert(`${alertFrom} moved to ${alertTo} context.`))
      clearTimeout(globals.errorTimer)
      // @ts-ignore
      globals.errorTimer = window.setTimeout(() => store.dispatch(alert(null)), 5000)
    }, 100)
  }
}

// eslint-disable-next-line jsdoc/require-jsdoc
const dropCollect = (connect: DropTargetConnector, monitor: DropTargetMonitor) => ({
  dropTarget: connect.dropTarget(),
  isDragInProgress: monitor.getItem(),
  isHovering: monitor.isOver({ shallow: true }) && monitor.canDrop()
})

/** Evals the code at this thought. */
const evalCode = ({ thoughtsRanked }: { thoughtsRanked: Path }) => {

  let codeResults // eslint-disable-line fp/no-let
  let ast // eslint-disable-line fp/no-let

  const state = store.getState()
  const { thoughts } = state
  const thought = getThought(state, headValue(thoughtsRanked))

  // ignore parse errors
  try {
    // @ts-ignore
    ast = esprima.parse(thought.code).body[0].expression
  }
  catch (e) {
    // ts-ignore-line no-empty
  }

  try {
    const env = {
      // find: predicate => Object.keys(thoughtIndex).find(key => predicate(getThought(key, thoughtIndex))),
      find: (predicate: any) => rankThoughtsSequential(Object.keys(thoughts.thoughtIndex).filter(predicate)),
      findOne: (predicate: any) => Object.keys(thoughts.thoughtIndex).find(predicate),
      home: () => getThoughtsRanked(state, RANKED_ROOT),
      thought: Object.assign({}, getThought(state, headValue(thoughtsRanked)), {
        children: () => getThoughtsRanked(state, thoughtsRanked)
      })
    }
    codeResults = evaluate(ast, env)

    // validate that each thought is ranked
    if (codeResults && codeResults.length > 0) {
      // @ts-ignore
      codeResults.forEach(thought => {
        assert(thought)
        assert.notStrictEqual(thought.value, undefined)
      })
    }
  }
  catch (e) {
    store.dispatch({ type: 'error', value: e.message })
    console.error('Dynamic Context Execution Error', e.message)
    codeResults = null
  }
}

/********************************************************************
 * Component
 ********************************************************************/

/** A message that says there are no children in this context. */
const NoChildren = ({ allowSingleContext, children, thoughtsRanked }: { allowSingleContext?: boolean, children: Child[], thoughtsRanked: Path }) =>
  <div className='children-subheading text-note text-small'>

    This thought is not found in any {children.length === 0 ? '' : 'other'} contexts.<br /><br />

    <span>{isMobile
      ? <span className='gesture-container'>Swipe <GestureDiagram path={subthoughtShortcut.gesture as GesturePath} size={30} color='darkgray' /></span>
      : <span>Type {formatKeyboardShortcut(subthoughtShortcut.keyboard!)}</span>
    } to add "{headValue(thoughtsRanked)}" to a new context.
    </span>

    <br />{allowSingleContext
      ? 'A floating context... how interesting.'
      : <span>{isMobile
        ? <span className='gesture-container'>Swipe <GestureDiagram path={toggleContextViewShortcut.gesture as GesturePath} size={30} color='darkgray'/* mtach .children-subheading color */ /></span>
        : <span>Type {formatKeyboardShortcut(toggleContextViewShortcut.keyboard!)}</span>
      } to return to the normal view.</span>
    }
  </div>

/** A drop target when there are no children in a context. Otherwise no drop target would be rendered in an empty context. */
const EmptyChildrenDropTarget = ({ depth, dropTarget, isDragInProgress, isHovering, isThoughtDivider }: { depth?: number, dropTarget: any, isDragInProgress?: boolean, isHovering?: boolean, isThoughtDivider?: boolean }) =>
  <ul className='empty-children' style={{ display: globals.simulateDrag || isDragInProgress ? 'block' : 'none' }}>
    {dropTarget(
      <li className={classNames({
        child: true,
        'drop-end': true,
        'inside-divider': isThoughtDivider,
        last: depth === 0
      })}>
        <span className='drop-hover' style={{ display: globals.simulateDropHover || isHovering ? 'inline' : 'none' }}></span>
      </li>
    )}
  </ul>

EmptyChildrenDropTarget.displayName = 'EmptyChildrenDropTarget'

/**
 * The static Subthoughts component.
 *
 * @param allowSingleContext         Allow showing a single context in context view. Default: false.
 * @param allowSingleContextParent   Pass through to Subthought since the SearchSubthoughts component does not have direct access. Default: false.
 * @param childrenForced             Optional.
 * @param contextBinding             Optional.
 * @param contextChain = []          Optional. Default: [].
 * @param count                      Optional. Default: 0.
 * @param depth.                     Optional. Default: 0.
 * @param isDragInProgress           Optional.
 * @param isEditingAncestor          Optional.
 * @param isHovering                 Optional.
 * @param showContexts               Optional.
 * @param showHiddenThoughts         Optional.
 * @param sort                       Optional. Default: contextSort.
 * @param thoughtsRanked             Renders the children of the given thoughtsRanked.
 */
export const SubthoughtsComponent = ({
  allowSingleContext,
  allowSingleContextParent,
  childrenForced,
  contextBinding,
  contextChain = [],
  count = 0,
  depth = 0,
  dropTarget,
  isDragInProgress,
  isEditingAncestor,
  isHovering,
  isParentHovering,
  showContexts,
  showHiddenThoughts,
  sort: contextSort,
  thoughtsRanked,
}: SubthoughtsComponentProps) => {

  // <Subthoughts> render
  const state = store.getState()
  const [page, setPage] = useState(1)
  const globalSort = getSetting(state, ['Global Sort']) || 'None'
  const sortPreference = contextSort || globalSort
  const { cursor } = state
  // TODO: This getThought call looking bit ambitious to me I am commenting the previous statement please check this.
  const thought = getThought(state, headValue(thoughtsRanked))

  // resolve thoughts that are part of a context chain (i.e. some parts of thoughts expanded in context view) to match against cursor subset
  const thoughtsResolved = contextChain && contextChain.length > 0
    ? chain(state, contextChain, thoughtsRanked)
    : unroot(thoughtsRanked)

  // @ts-ignore
  const codeResults = thought && thought.code ? evalCode({ thought, thoughtsRanked }) : null

  const show = depth < MAX_DEPTH && (isEditingAncestor || store.getState().expanded[hashContext(thoughtsResolved)])

  // disable intrathought linking until add, edit, delete, and expansion can be implemented
  // const subthought = perma(() => getSubthoughtUnderSelection(headValue(thoughtsRanked), 3))

  const children = childrenForced ? childrenForced // eslint-disable-line no-unneeded-ternary
    // @ts-ignore
    : codeResults && codeResults.length && codeResults[0] && codeResults[0].value ? codeResults
    : showContexts ? getContextsSortedAndRanked(state, /* subthought() || */headValue(thoughtsRanked))
    : sortPreference === 'Alphabetical' ? getThoughtsSorted(state, pathToContext(contextBinding || thoughtsRanked))
    : getThoughtsRanked(state, contextBinding || thoughtsRanked)

  // check duplicate ranks for debugging
  // React prints a warning, but it does not show which thoughts are colliding
  if (globals.checkDuplicateRanks) {
    children.reduce((accum, child) => {
      const match = accum[child.rank]
      if (match) {
        console.warn('Duplicate child rank', match[0], child)
        console.warn('thoughtsRanked', thoughtsRanked)
      }
      return {
        ...accum,
        [child.rank]: (match || []).concat(child)
      }
    }, {})
  }

  // Ensure that editable newThought is visible.
  const editIndex = cursor && children && show ? children.findIndex(child => {
    return cursor[depth] && cursor[depth].rank === child.rank
  }) : 0
  const filteredChildren = children.filter(child => {
    const value = showContexts ? head(child.context) : child.value
    return showHiddenThoughts ||
      // exclude meta thoughts when showHiddenThoughts is off
      // NOTE: child.rank is not used by isChildVisible
      isChildVisible(state, pathToContext(thoughtsRanked), { value, rank: child.rank }) ||
      // always include thoughts in cursor
      (cursor && equalThoughtRanked(cursor[thoughtsRanked.length], child))
  })

  const proposedPageSize = isRoot(thoughtsRanked)
    ? Infinity
    : PAGINATION_SIZE * page
  if (editIndex > proposedPageSize - 1) {
    setPage(page + 1)
    return null
  }
  const isPaginated = show && filteredChildren.length > proposedPageSize
  // expand root, editing path, and contexts previously marked for expansion in setCursor

  // get shared subcontext index between cursor and thoughtsResolved
  const subcontextIndex = checkIfPathShareSubcontext(cursor || [], thoughtsResolved)

  // check if thoughtResolved is ancestor, descendant of cursor or is equal to cursor itself
  const isAncestorOrDescendant = (subcontextIndex + 1) === (cursor || []).length
  || (subcontextIndex + 1) === thoughtsResolved.length

  // If the cursor is a leaf, use cursor.length - 1 so that the autofocus stays one level zoomed out.
  // This feels more intuitive and stable for moving the cursor in and out of leaves.
  // In this case, the grandparent must be given the cursor-parent className so it is not hidden (below)
  // TODO: Resolve cursor to a ThoughtsRanked
  const isCursorLeaf = cursor && !getThoughts(state, pathToContext(cursor))
    .some((child: Child) => !isFunction(child.value))
  const cursorDepth = cursor
    ? cursor.length - (isCursorLeaf ? 1 : 0)
    : 0
  const distance = cursor ? Math.max(0,
    Math.min(MAX_DISTANCE_FROM_CURSOR, cursorDepth - depth)
  ) : 0

  /*
    Check if the chilren are distant relatives and their depth equals to or greater than cursor.
    With current implementation we don't cosider the condition where a node which is neither ancestor or descendant
    of cursor can have zero distance-from-cursor. So we check the condition here and dim the nodes.
  */
  const shouldDim = (distance === 0) && !isAncestorOrDescendant

  /*
    Unlike normal view where there is only one expanded thougt in a context, table view node has all its children expand and render their respective subthoughts.
    If we select any grandchildren of the main table view node, all it's children will disappear but the grandchildren will still show up.
    We check that condtion and hide the node.
  */
  const shouldHide = (distance === 1) && !isAncestorOrDescendant && thoughtsResolved.length > 0

  /*
    When =focus/Zoom is set on the cursor or parent of the cursor, change the autofocus so that it hides the level above.
    1. Force actualDistance to 2 to hide thoughts.
    2. Set zoomCursor and zoomParent CSS classes to handle siblings.
  */
  const zoomCursor = cursor && (attribute(state, pathToContext(cursor), '=focus') === 'Zoom'
    || attribute(state, pathToContext(contextOf(cursor)).concat('=children'), '=focus') === 'Zoom')
  const zoomParent = cursor && (attribute(state, pathToContext(contextOf(cursor)), '=focus') === 'Zoom'
    || attribute(state, pathToContext(contextOf(contextOf(cursor))).concat('=children'), '=focus') === 'Zoom')
  const zoomParentEditing = () => cursor && cursor.length > 2 && zoomParent && equalPath(contextOf(contextOf(cursor)), thoughtsResolved) // eslint-disable-line jsdoc/require-jsdoc
  const zoom = isEditingAncestor && (zoomCursor || zoomParentEditing())

  const actualDistance =
    shouldHide || zoom ? 2
    : shouldDim ? 1
    : distance

  const context = pathToContext(thoughtsRanked)
  const contextChildren = context.concat('=children') // children of parent with =children
  const contextGrandchildren = contextOf(context).concat('=grandchildren') // context of grandparent with =grandchildren
  const styleChildren = getStyle(state, contextChildren)
  const styleGrandChildren = getStyle(state, contextGrandchildren)
  const hideBulletsChildren = attribute(state, contextChildren, '=bullet') === 'None'
  const hideBulletsGrandchildren = attribute(state, contextGrandchildren, '=bullet') === 'None'
  const cursorOnAlphabeticalSort = cursor && attributeEquals(state, context, '=sort', 'Alphabetical')

  return <React.Fragment>

    {contextBinding && showContexts ? <div className='text-note text-small'>(Bound to {pathToContext(contextBinding!).join('/')})</div> : null}

    {show && showContexts && !(children.length === 0 && isRoot(thoughtsRanked))
      ? children.length < (allowSingleContext ? 1 : 2) ?

        // No children
        <NoChildren allowSingleContext={allowSingleContext} children={children} thoughtsRanked={thoughtsRanked} />

        // "Contexts:"
        : children.length > (showContexts && !allowSingleContext ? 1 : 0) ? <div className='children-subheading text-note text-small' style={{ top: '4px' }}>Context{children.length === 1 ? '' : 's'}:
        </div>

        : null

      : null}

    {children.length > (showContexts && !allowSingleContext ? 1 : 0) && show ? <ul
      // thoughtIndex-thoughts={showContexts ? hashContext(unroot(pathToContext(thoughtsRanked))) : null}
      className={classNames({
        children: true,
        'context-chain': showContexts,
        [`distance-from-cursor-${actualDistance}`]: true,
        zoomCursor,
        zoomParent,
      })}
    >
      {filteredChildren
        .map((child, i) => {
          if (i >= proposedPageSize) {
            return null
          }
          const childPath = getChildPath(state, child, thoughtsRanked, showContexts)
          const childContext = pathToContext(childPath)

          /** Returns true if the cursor in in the child path. */
          const isEditingChildPath = () => subsetThoughts(state.cursorBeforeEdit, childPath)
          const styleZoom = getStyle(state, [...childContext, '=focus', 'Zoom'])

          /** Returns true if the bullet should be hidden. */
          const hideBullet = () => attribute(state, childContext, '=bullet') === 'None'

          /** Returns true if the bullet should be hidden if zoomed. */
          const hideBulletZoom = () => isEditingChildPath() && attribute(state, [...childContext, '=focus', 'Zoom'], '=bullet') === 'None'

          /*
            simply using index i as key will result in very sophisticated rerendering when new Empty thoughts are added.
            The main problem is that when a new Thought is added it will get key (index) of the previous thought,
            causing React DOM to think it as old component that needs re-render and thus the new thoughyt won't be able to mount itself as a new component.

            By using child's rank we have unique key for every new thought.
            Using unique rank will help React DOM to properly identify old components and the new one. Thus eliminating sophisticated
            re-renders.
          */

          return child ? <Thought
            allowSingleContext={allowSingleContextParent}
            // grandchildren can be manually added in code view
            childrenForced={child.children}
            contextChain={showContexts ? contextChain.concat([thoughtsRanked]) : contextChain}
            count={count + sumSubthoughtsLength(children)}
            depth={depth + 1}
            hideBullet={hideBulletsChildren || hideBulletsGrandchildren || hideBullet() || hideBulletZoom()}
            key={`${child.id || child.rank}${child.context ? '-context' : ''}`}
            rank={child.rank}
            isDraggable={actualDistance < 2}
            showContexts={showContexts}
            prevChild={filteredChildren[i - 1]}
            isParentHovering={isParentHovering}
            style={{
              ...styleGrandChildren,
              ...styleChildren,
              ...isEditingChildPath() ? styleZoom : null,
            }}
            thoughtsRanked={childPath}
          /> : null
        })}
      {dropTarget(<li className={classNames({
        child: true,
        'drop-end': true,
        last: depth === 0
      })} style={{ display: globals.simulateDrag || isDragInProgress ? 'list-item' : 'none' }}>
        <span className='drop-hover' style={{ display: (globals.simulateDropHover || isHovering) && !cursorOnAlphabeticalSort ? 'inline' : 'none' }}></span>
      </li>)}
    </ul> : <EmptyChildrenDropTarget
      isThoughtDivider={isDivider(headValue(thoughtsRanked))}
      depth={depth}
      dropTarget={dropTarget}
      isDragInProgress={isDragInProgress}
      isHovering={isHovering}
    />}
    {isPaginated && distance !== 2 && <a className='indent text-note' onClick={() => setPage(page + 1)}>More...</a>}
  </React.Fragment>
}

SubthoughtsComponent.displayName = 'SubthoughtComponent'

const Subthoughts = connect(mapStateToProps)(DropTarget('thought', { canDrop, drop }, dropCollect)(SubthoughtsComponent))

export default Subthoughts
