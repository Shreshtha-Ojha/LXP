import { type ReactNode } from 'react'
import { CourseCard } from './CourseCard'
import { CourseCardSkeleton } from './CourseCardSkeleton'
import type { CatalogueCourse } from './types'

export interface CourseRowProps {
  title: string
  courses: CatalogueCourse[]
  isLoading?: boolean
  emptyState?: ReactNode
}

const SKELETON_COUNT = 4

/** Horizontal scrolling row of course cards, used by the browse sections on /learn. */
export function CourseRow({ title, courses, isLoading = false, emptyState }: CourseRowProps) {
  if (!isLoading && courses.length === 0 && !emptyState) return null

  return (
    <section>
      <h2 className="mb-3 text-[15px] font-medium text-fg">{title}</h2>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
            <div key={index} className="w-[300px] shrink-0">
              <CourseCardSkeleton />
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        emptyState
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {courses.map((course) => (
            <div key={course.id} className="w-[300px] shrink-0">
              <CourseCard course={course} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
