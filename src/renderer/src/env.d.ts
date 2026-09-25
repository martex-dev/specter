import type * as React from 'react'

declare global {
  // React 19 no longer provides a global JSX namespace; SPECTER uses JSX.Element in a few signatures.
  namespace JSX {
    type Element = React.JSX.Element
  }
}

export {}
