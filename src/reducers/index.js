// reducers
import alert from './alert'
import authenticate from './authenticate'
import clear from './clear'
import clearQueue from './clearQueue'
import cursorBeforeSearch from './cursorBeforeSearch'
import cursorHistory from './cursorHistory'
import deleteData from './deleteData'
import deleteSubthoughts from './deleteSubthoughts'
import dragInProgress from './dragInProgress'
import editing from './editing'
import editingValue from './editingValue'
import error from './error'
import existingThoughtChange from './existingThoughtChange'
import existingThoughtDelete from './existingThoughtDelete'
import existingThoughtMove from './existingThoughtMove'
import expandContextThought from './expandContextThought'
import indent from './indent'
import invalidState from './invalidState'
import loadLocalState from './loadLocalState'
import loadLocalThoughts from './loadLocalThoughts'
import modalComplete from './modalComplete'
import modalRemindMeLater from './modalRemindMeLater'
import newThought from './newThought'
import newThoughtSubmit from './newThoughtSubmit'
import render from './render'
import search from './search'
import searchLimit from './searchLimit'
import selectionChange from './selectionChange'
import setCursor from './setCursor'
import setFirstSubthought from './setFirstSubthought'
import setResourceCache from './setResourceCache'
import settings from './settings'
import showModal from './showModal'
import status from './status'
import subCategorizeAll from './subCategorizeAll'
import subCategorizeOne from './subCategorizeOne'
import toggleCodeView from './toggleCodeView'
import toggleContextView from './toggleContextView'
import toggleHiddenThoughts from './toggleHiddenThoughts'
import toggleSidebar from './toggleSidebar'
import toggleSplitView from './toggleSplitView'
import tutorial from './tutorial'
import tutorialChoice from './tutorialChoice'
import tutorialNext from './tutorialNext'
import tutorialPrev from './tutorialPrev'
import tutorialStep from './tutorialStep'
import unknownAction from './unknownAction'
import updateSplitPosition from './updateSplitPosition'
import updateThoughts from './updateThoughts'
import { prioritizeScroll, setToolbarOverlay } from './toolbarOverlay'

import { initialState } from '../util'

const reducerMap = {
  alert,
  authenticate,
  clear,
  clearQueue,
  cursorBeforeSearch,
  cursorHistory,
  deleteData,
  deleteSubthoughts,
  dragInProgress,
  editing,
  editingValue,
  error,
  existingThoughtChange,
  existingThoughtDelete,
  existingThoughtMove,
  expandContextThought,
  indent,
  invalidState,
  loadLocalState,
  loadLocalThoughts,
  modalComplete,
  modalRemindMeLater,
  newThought,
  newThoughtSubmit,
  prioritizeScroll,
  render,
  search,
  searchLimit,
  selectionChange,
  setCursor,
  setFirstSubthought,
  setResourceCache,
  settings,
  setToolbarOverlay,
  subCategorizeAll,
  subCategorizeOne,
  showModal,
  status,
  toggleCodeView,
  toggleContextView,
  toggleHiddenThoughts,
  toggleSidebar,
  toggleSplitView,
  tutorial,
  tutorialChoice,
  tutorialNext,
  tutorialPrev,
  tutorialStep,
  updateSplitPosition,
  updateThoughts,
}

/**
 * The main reducer.
 * Use action.type to select the reducer with the same name.
 * Otherwise throw an error with unknownAction.
 */
export default (state = initialState(), action) =>
  (reducerMap[action.type] || unknownAction)(state, action)
