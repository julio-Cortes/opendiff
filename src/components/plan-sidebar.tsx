import type { ScrollBoxRenderable } from "@opentui/core"
import { createEffect, For, Show } from "solid-js"
import { COLORS, LAYOUT } from "../config"
import type { FeaturePlan } from "../plans"

type PlanSidebarProps = {
  active: boolean
  plan?: FeaturePlan
  selectedPr: number
  selectedTask: number
  focusedSection: "prs" | "tasks"
  onReady: (taskList: ScrollBoxRenderable) => void
}

export function PlanSidebar(props: PlanSidebarProps) {
  let taskList: ScrollBoxRenderable | undefined
  const current = () => props.plan?.prs[props.selectedPr]
  const totals = () => {
    const tasks = props.plan?.prs.flatMap((pr) => pr.tasks) ?? []
    return { complete: tasks.filter((task) => task.complete).length, total: tasks.length }
  }

  createEffect(() => {
    if (!current()?.tasks[props.selectedTask]) return
    taskList?.scrollChildIntoView(`task-${props.selectedTask}`)
  })

  return (
    <box
      width={LAYOUT.planSidebarWidth}
      minWidth={LAYOUT.planSidebarMinWidth}
      maxWidth={LAYOUT.planSidebarMaxWidth}
      flexDirection="column"
      borderStyle="single"
      borderColor={props.active ? COLORS.selection : COLORS.border}
    >
      <Show when={props.plan} fallback={
        <box flexGrow={1} alignItems="center" justifyContent="center" paddingLeft={1} paddingRight={1}>
          <text fg={COLORS.textMuted}>No active feature plan</text>
        </box>
      }>
        {(plan) => (
          <>
            <box flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor={COLORS.panel}>
              <text fg={COLORS.textStrong}><b>{plan().title}</b></text>
              <text fg={COLORS.textMuted}>{totals().complete}/{totals().total} tasks complete</text>
            </box>
            <box flexDirection="column" paddingTop={1} paddingBottom={1}>
              <For each={plan().prs}>
                {(pr, index) => (
                  <text
                    fg={props.selectedPr === index() ? COLORS.textStrong : COLORS.textMuted}
                    bg={props.selectedPr === index() ? props.active && props.focusedSection === "prs" ? COLORS.selection : COLORS.panel : COLORS.canvas}
                  >
                    {pr.number}. {pr.title} [{pr.status}]
                  </text>
                )}
              </For>
            </box>
            <box height={1} paddingLeft={1} backgroundColor={COLORS.panel}>
              <text fg={COLORS.text}>{current()?.branch || current()?.title}</text>
            </box>
            <scrollbox
              ref={(element) => {
                taskList = element
                props.onReady(element)
              }}
              flexGrow={1}
              scrollX={false}
              scrollY
              paddingTop={1}
            >
              <For each={current()?.tasks ?? []}>
                {(task, index) => (
                  <text
                    id={`task-${index()}`}
                    fg={props.selectedTask === index() ? COLORS.textStrong : task.complete ? COLORS.textMuted : COLORS.text}
                    bg={props.selectedTask === index() ? props.active && props.focusedSection === "tasks" ? COLORS.selection : COLORS.panel : COLORS.canvas}
                  >
                    [{task.complete ? "x" : " "}] {task.text}
                  </text>
                )}
              </For>
            </scrollbox>
          </>
        )}
      </Show>
    </box>
  )
}
