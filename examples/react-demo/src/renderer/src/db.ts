import { connectDB } from 'minnaldb-electron/renderer'
import { schema } from '../../shared/schema.js'

export const db = connectDB(schema)
export { projects, tasks } from '../../shared/schema.js'
