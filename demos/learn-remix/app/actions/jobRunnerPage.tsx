import { type Handle } from 'remix/ui'
import { Layout } from '../ui/layout.tsx'
import { AsyncJobRunner } from '../assets/jobRunner.tsx'

export function JobRunnerPage(handle: Handle) {
  return () => (
    <Layout>
      <h1>Async job runner</h1>
      <AsyncJobRunner />
    </Layout>
  )
}
