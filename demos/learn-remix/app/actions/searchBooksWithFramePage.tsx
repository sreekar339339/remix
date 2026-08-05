import { type Handle } from 'remix/ui'
import { Layout } from '../ui/layout.tsx'
import { SearchBooksWithFrame } from '../assets/searchBooksWithFrame.tsx'

export function SearchBooksWithFramePage(handle: Handle<{ initialQuery: string }>) {
  return () => (
    <Layout>
      <h1>Search books with frame</h1>
      <SearchBooksWithFrame initialQuery={handle.props.initialQuery} />
    </Layout>
  )
}
