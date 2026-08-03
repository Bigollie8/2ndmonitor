/** Everything that can pin the auto-hiding top bar open (0.6.7 §3).
 *  App-level overlay flags plus the bar's own ⋯ dropdown: `menuOpen` is
 *  TopChrome-LOCAL state, reported up to App via TopChrome's
 *  `onMenuOpenChange` prop — App composes it with its own flags and owns
 *  the decision (see topBarPinned in App.tsx). */
export interface TopBarPinInputs {
  editMode: boolean;
  showSettings: boolean;
  showContentLibrary: boolean;
  showSwitcher: boolean;
  showOnboarding: boolean;
  showShortcuts: boolean;
  /** The bar's own ⋯ dropdown. */
  menuOpen: boolean;
}

/** True when the top bar must stay visible regardless of pointer position:
 *  an overlay whose entry point or context lives in the bar is open, or one
 *  of the bar's own dropdowns is. Pure — node-tested in topBar.test.ts. */
export function shouldPinTopBar(inputs: TopBarPinInputs): boolean {
  return (
    inputs.editMode ||
    inputs.showSettings ||
    inputs.showContentLibrary ||
    inputs.showSwitcher ||
    inputs.showOnboarding ||
    inputs.showShortcuts ||
    inputs.menuOpen
  );
}
