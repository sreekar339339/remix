import { type Handle } from 'remix/ui'
import { Layout } from '../ui/layout.tsx'
import { SearchBooksWithoutFrame } from '../assets/searchBooksWithoutFrame.tsx'

export function SearchBooksWithoutFramePage(handle: Handle<{ initialQuery: string }>) {
  return () => (
    <Layout>
      <h1>Search books without frame</h1>
      <SearchBooksWithoutFrame initialQuery={handle.props.initialQuery} />
    </Layout>
  )
}
