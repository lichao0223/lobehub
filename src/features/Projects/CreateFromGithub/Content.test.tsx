/**
 * @vitest-environment happy-dom
 */
import type * as LobeUI from '@lobehub/ui';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CreateFromGithubContent from './Content';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  createProject: vi.fn(),
  navigate: vi.fn(),
}));

const githubRepositories = [
  {
    defaultBranch: 'main',
    fullName: 'acme/web',
    url: 'https://github.com/acme/web',
  },
  {
    defaultBranch: 'develop',
    fullName: 'acme/api',
    url: 'https://github.com/acme/api',
  },
];

const tfsRepositories = [
  {
    defaultBranch: 'main',
    fullName: 'Proj/RepoA',
    id: 'repo-a',
    name: 'RepoA',
    project: 'Proj',
    url: 'https://tfs.example.com/DefaultCollection/Proj/_git/RepoA',
  },
  {
    defaultBranch: 'develop',
    fullName: 'Proj/RepoB',
    id: 'repo-b',
    name: 'RepoB',
    project: 'Proj',
    url: 'https://tfs.example.com/DefaultCollection/Proj/_git/RepoB',
  },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeUI>();
  return {
    ...actual,
    useModalContext: () => ({ close: mocks.close }),
  };
});

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/store/project', () => ({
  useProjectStore: (selector: (state: { createProject: typeof mocks.createProject }) => unknown) =>
    selector({ createProject: mocks.createProject }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: {
    getState: () => ({ refreshAgentLabels: vi.fn(), refreshAgentList: vi.fn() }),
  },
}));

vi.mock('../useDefaultMainAgent', () => ({
  useDefaultMainAgent: () => 'inbox-agent',
}));

vi.mock('../MainAgentSection', () => ({
  default: ({
    agentId,
    onAgentChange,
  }: {
    agentId?: string;
    onAgentChange: (id: string) => void;
  }) => (
    <div>
      <span data-testid={'main-agent'}>{agentId ?? 'none'}</span>
      <button type={'button'} onClick={() => onAgentChange('picked-agent')}>
        pick-agent
      </button>
    </div>
  ),
}));

vi.mock('./RepositoryField', () => ({
  AdvancedRepositories: () => <div data-testid={'advanced-repositories'} />,
  MAX_REPOSITORIES: 10,
  default: ({ onChange }: { onChange: (repositories: unknown[]) => void }) => (
    <button type={'button'} onClick={() => onChange(githubRepositories)}>
      pick-github
    </button>
  ),
}));

vi.mock('@/features/Tfs/TfsRepositoryPicker', () => ({
  TfsRepositoryPicker: ({ onChange }: { onChange: (repositories: unknown[]) => void }) => (
    <button type={'button'} onClick={() => onChange(tfsRepositories)}>
      pick-tfs
    </button>
  ),
}));

const create = async () => {
  fireEvent.click(screen.getByText('create.action'));
  await waitFor(() => expect(mocks.createProject).toHaveBeenCalledTimes(1));
  return mocks.createProject.mock.calls[0]![0];
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createProject.mockResolvedValue({ id: 'prj_1', slug: 'repo-a' });
});

afterEach(cleanup);

describe('CreateFromGithubContent', () => {
  it('creates a project from several TFS repositories in one list', async () => {
    render(<CreateFromGithubContent provider={'tfs'} />);

    fireEvent.click(screen.getByText('pick-tfs'));

    const request = await create();

    expect(request).toEqual(
      expect.objectContaining({
        coordinatorAgentId: 'inbox-agent',
        repository: {
          defaultBranch: 'main',
          name: 'Proj/RepoA',
          url: 'https://tfs.example.com/DefaultCollection/Proj/_git/RepoA',
        },
        additionalRepositories: [
          {
            defaultBranch: 'develop',
            url: 'https://tfs.example.com/DefaultCollection/Proj/_git/RepoB',
          },
        ],
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/project/repo-a');
  });

  it('creates a project from several GitHub repositories through the upstream field', async () => {
    render(<CreateFromGithubContent />);

    expect(screen.getByTestId('advanced-repositories')).toBeInTheDocument();
    fireEvent.click(screen.getByText('pick-github'));

    const request = await create();

    expect(request).toEqual(
      expect.objectContaining({
        repository: {
          defaultBranch: 'main',
          name: 'acme/web',
          url: 'https://github.com/acme/web',
        },
        additionalRepositories: [{ defaultBranch: 'develop', url: 'https://github.com/acme/api' }],
      }),
    );
  });

  it('starts from the workspace inbox agent and keeps an explicit pick', async () => {
    render(<CreateFromGithubContent />);

    fireEvent.click(screen.getByText('pick-github'));
    expect(screen.getByTestId('main-agent')).toHaveTextContent('inbox-agent');

    fireEvent.click(screen.getByText('pick-agent'));
    expect(screen.getByTestId('main-agent')).toHaveTextContent('picked-agent');

    const request = await create();
    expect(request).toEqual(expect.objectContaining({ coordinatorAgentId: 'picked-agent' }));
  });
});
