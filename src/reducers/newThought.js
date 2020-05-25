import globals from '../globals'

// constants
import {
  RANKED_ROOT,
  TUTORIAL2_STEP_CONTEXT1,
  TUTORIAL2_STEP_CONTEXT1_HINT,
  TUTORIAL2_STEP_CONTEXT1_PARENT,
  TUTORIAL2_STEP_CONTEXT1_PARENT_HINT,
  TUTORIAL2_STEP_CONTEXT2,
  TUTORIAL2_STEP_CONTEXT2_HINT,
  TUTORIAL2_STEP_CONTEXT2_PARENT,
  TUTORIAL2_STEP_CONTEXT2_PARENT_HINT,
  TUTORIAL_STEP_FIRSTTHOUGHT,
  TUTORIAL_STEP_FIRSTTHOUGHT_ENTER,
  TUTORIAL_STEP_SECONDTHOUGHT,
  TUTORIAL_STEP_SECONDTHOUGHT_ENTER,
  TUTORIAL_STEP_SUBTHOUGHT,
} from '../constants'

// util
import {
  contextOf,
  ellipsize,
  headValue,
  pathToContext,
  unroot,
} from '../util'

// selectors
import {
  getNextRank,
  getPrevRank,
  getRankAfter,
  getRankBefore,
  getSetting,
  isContextViewActive,
  lastThoughtsFromContextChain,
  meta,
  splitChain,
} from '../selectors'

// reducers
import newThoughtSubmit from './newThoughtSubmit'
import setCursor from './setCursor'
import tutorialNext from './tutorialNext'
import tutorialStepReducer from './tutorialStep'

/** Adds a new thought to the cursor. NOOP if the cursor is not set.
 *
 * @param offset The focusOffset of the selection in the new thought. Defaults to end.
 */
export default (state, { at, insertNewSubthought, insertBefore, value = '', offset, preventSetCursor } = {}) => {
  const tutorialStep = +getSetting(state, 'Tutorial Step')
  const tutorialStepNewThoughtCompleted =
    // new thought
    (!insertNewSubthought && (
      Math.floor(tutorialStep) === TUTORIAL_STEP_FIRSTTHOUGHT ||
      Math.floor(tutorialStep) === TUTORIAL_STEP_SECONDTHOUGHT
    )) ||
    // new thought in context
    (insertNewSubthought && Math.floor(tutorialStep) === TUTORIAL_STEP_SUBTHOUGHT) ||
    // enter after typing text
    (state.cursor && headValue(state.cursor).length > 0 &&
      (tutorialStep === TUTORIAL_STEP_SECONDTHOUGHT_ENTER ||
        tutorialStep === TUTORIAL_STEP_FIRSTTHOUGHT_ENTER))

  const path = at || state.cursor || RANKED_ROOT

  // prevent adding Subthought to readonly or unextendable Thought
  const sourcePath = insertNewSubthought ? path : contextOf(path)
  if (meta(state, pathToContext(sourcePath)).readonly) {
    return {
      type: 'error',
      value: `"${ellipsize(headValue(sourcePath))}" is read-only. No subthoughts may be added.`
    }
  }
  else if (meta(state, pathToContext(sourcePath)).unextendable) {
    return {
      type: 'error',
      value: `"${ellipsize(headValue(sourcePath))}" is unextendable. No subthoughts may be added.`
    }
  }

  const contextChain = splitChain(state, path)
  const showContexts = isContextViewActive(state, path)
  const showContextsParent = isContextViewActive(state, contextOf(path))
  const thoughtsRanked = contextChain.length > 1
    ? lastThoughtsFromContextChain(state, contextChain)
    : path
  const context = pathToContext(showContextsParent && contextChain.length > 1 ? contextChain[contextChain.length - 2]
    : !showContextsParent && thoughtsRanked.length > 1 ? contextOf(thoughtsRanked) :
    RANKED_ROOT)

  // use the live-edited value
  // const thoughtsLive = showContextsParent
  //   ? contextOf(contextOf(thoughts)).concat().concat(head(thoughts))
  //   : thoughts
  // const thoughtsRankedLive = showContextsParent
  //   ? contextOf(contextOf(path).concat({ value: innerTextRef, rank })).concat(head(path))
  //   : path

  // if meta key is pressed, add a child instead of a sibling of the current thought
  // if shift key is pressed, insert the child before the current thought
  const newRank = (showContextsParent && !insertNewSubthought) || (showContexts && insertNewSubthought) ? 0 // rank does not matter here since it is autogenerated
    : (insertBefore
      ? insertNewSubthought || !path ? getPrevRank : getRankBefore
      : insertNewSubthought || !path ? getNextRank : getRankAfter
    )(state, thoughtsRanked)

  const reducers = [

    // newThoughtSubmit
    state => newThoughtSubmit(state, {
      context: insertNewSubthought
        ? pathToContext(thoughtsRanked)
        : context,
      // inserting a new child into a context functions the same as in the normal thought view
      addAsContext: (showContextsParent && !insertNewSubthought) || (showContexts && insertNewSubthought),
      rank: newRank,
      value
    }),

    // setCursor
    !preventSetCursor
      ? state => setCursor(state, {
        editing: true,
        thoughtsRanked: (insertNewSubthought ? unroot(path) : contextOf(path)).concat({ value, rank: newRank }),
        offset: offset != null ? offset : value.length,
      })
      : null,

    // tutorial step 1
    tutorialStepNewThoughtCompleted ? clearTimeout(globals.newSubthoughtModalTimeout) || (state => tutorialNext(state))
    // some hints are rolled back when a new thought is created
    : tutorialStep === TUTORIAL2_STEP_CONTEXT1_PARENT_HINT
      ? state => tutorialStepReducer(state, { value: TUTORIAL2_STEP_CONTEXT1_PARENT })
      : tutorialStep === TUTORIAL2_STEP_CONTEXT1_HINT ?
        state => tutorialStepReducer(state, { value: TUTORIAL2_STEP_CONTEXT1 })
        : tutorialStep === TUTORIAL2_STEP_CONTEXT2_PARENT_HINT ?
          state => tutorialStepReducer(state, { value: TUTORIAL2_STEP_CONTEXT2_PARENT })
          : tutorialStep === TUTORIAL2_STEP_CONTEXT2_HINT ?
            state => tutorialStepReducer(state, { value: TUTORIAL2_STEP_CONTEXT2 })
            : null,

    // return new rank in case composed reducers need it
    state => ({
      newRank
    })
  ]

  return reducers.reduce((state, reducer) => ({
    ...state,
    ...reducer ? reducer(state) : null,
  }), state)
}
