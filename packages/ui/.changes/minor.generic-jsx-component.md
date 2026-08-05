Add a `GenericJSXComponent` type opt-in for components whose call signatures directly describe their JSX props. A component function intersected with `GenericJSXComponent` keeps its own prop inference in JSX instead of being typed as a `Handle<props>` factory, which allows generic, overloaded call signatures such as per-tag intrinsic element factories:

```tsx
declare const view: {
  div: GenericJSXComponent & ((props: Props<'div'>) => RemixNode)
}

// props are checked against the call signature, including generics
;<view.div class="box" />
```
