// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageMedia } from '@/domain/messages/media';
import { DocumentMessage } from './DocumentMessage';

const documentMedia: Extract<MessageMedia, { kind: 'document' }> = {
  kind: 'document',
  name: 'Project brief.PDF',
  url: '/media/project-brief.pdf',
  size: 1572864,
  mimeType: 'application/pdf',
};

afterEach(cleanup);

describe('document messages', () => {
  it.each([
    { size: 0, label: '0 B' },
    { size: 1023, label: '1023 B' },
    { size: 1024, label: '1 KB' },
    { size: 1048576, label: '1.0 MB' },
    { size: 1572864, label: '1.5 MB' },
    { size: 1073741824, label: '1.00 GB' },
  ])('shows $size bytes as $label without a MIME suffix', ({ size, label }) => {
    render(<DocumentMessage media={{ ...documentMedia, size }} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(/application\/pdf/)).toBeNull();
  });

  it.each([
    { name: 'Project brief.PDF', extension: 'pdf' },
    { name: 'archive.backup.zip', extension: 'zip' },
    { name: 'README', extension: 'file' },
    { name: '.gitignore', extension: 'file' },
    { name: 'unfinished.', extension: 'file' },
  ])('identifies the file type of $name as $extension', ({ name, extension }) => {
    render(<DocumentMessage media={{ ...documentMedia, name }} />);

    expect(screen.getByText(extension)).toBeTruthy();
    expect(screen.getByText(name)).toBeTruthy();
  });

  it.each(['/media/project-brief.pdf', 'blob:http://localhost/document-preview'])(
    'downloads the supplied file URL %s under its original filename',
    (url) => {
      render(<DocumentMessage media={{ ...documentMedia, url }} />);

      const downloadLink = screen.getByRole('link');
      expect(downloadLink.getAttribute('href')).toBe(url);
      expect(downloadLink.getAttribute('download')).toBe('Project brief.PDF');
    },
  );
});
