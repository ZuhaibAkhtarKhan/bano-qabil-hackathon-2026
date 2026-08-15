import type { Application } from './types'

export const applications: Application[] = [
  {
    id: 'openai-residency',
    title: 'OpenAI Residency',
    organization: 'OpenAI',
    type: 'Research residency',
    deadline: '2026-08-24',
    deadlineLabel: '24 Aug',
    status: 'Ready',
    tone: 'blue',
  },
  {
    id: 'rhodes-scholarship',
    title: 'Rhodes Scholarship',
    organization: 'Rhodes Trust',
    type: 'Postgraduate scholarship',
    deadline: '2026-09-04',
    deadlineLabel: '4 Sep',
    status: 'Draft',
    tone: 'orange',
  },
  {
    id: 'ethglobal-bangkok',
    title: 'ETHGlobal Bangkok',
    organization: 'ETHGlobal',
    type: 'Hackathon',
    deadline: '2026-09-12',
    deadlineLabel: '12 Sep',
    status: 'Submitted',
    tone: 'green',
  },
  {
    id: 'systems-fellowship',
    title: 'Frontier Systems Fellowship',
    organization: 'Arc Institute',
    type: 'Fellowship',
    deadline: '2026-10-03',
    deadlineLabel: '3 Oct',
    status: 'Interview',
    tone: 'blue',
  },
]

export const evidence = [
  { name: 'Education', source: 'Transcript' },
  { name: 'Work experience', source: 'LinkedIn' },
  { name: 'Projects', source: 'GitHub' },
  { name: 'Skills', source: 'Resume' },
  { name: 'Awards', source: 'Certificate' },
]
