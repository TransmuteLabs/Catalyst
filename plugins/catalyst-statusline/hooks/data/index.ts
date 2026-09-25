import type { Collector } from './types'
import base from './base'
import usage from './usage'
import activity from './activity'
import repo from './repo'
import external from './external'

// CONSTRAINT: the complete registry of the core's data families — a family
// runs only by standing in this array.
export const FAMILIES: Collector<unknown>[] = [
  base as Collector<unknown>,
  usage as Collector<unknown>,
  activity as Collector<unknown>,
  repo as Collector<unknown>,
  external as Collector<unknown>,
]
