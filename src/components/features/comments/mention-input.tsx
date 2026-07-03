'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Textarea } from '@/components/ui/textarea';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPharmacistsApiPath } from '@/lib/pharmacists/api-paths';

type StaffMember = {
  id: string;
  name: string;
};

// insertMention は本文へ `@${name}` を挿入し、直後に区切り（空白）を置く。
// 編集で表示名が消えた mention を検出するため、同じ規則（@名前 + 区切り）で
// 本文に残っているかを判定する。部分一致の罠（ある名前が別の名前の接頭辞に
// なる、名前が他の単語の部分文字列になる）を避けるため、`@name` の直後が
// 語境界（文字列末尾・空白・別のメンションの @）である場合のみ「存在する」とみなす。
function isMentionDisplayPresent(text: string, name: string): boolean {
  if (!name) return false;
  const token = `@${name}`;
  let searchFrom = 0;
  for (;;) {
    const at = text.indexOf(token, searchFrom);
    if (at === -1) return false;
    const nextChar = text[at + token.length];
    // 末尾・空白（全角空白含む）・別メンションの @ を語境界として扱う。
    if (nextChar === undefined || nextChar === '@' || /\s/.test(nextChar)) {
      return true;
    }
    searchFrom = at + 1;
  }
}

type MentionInputProps = {
  value: string;
  onChange: (value: string) => void;
  mentions: string[];
  onMentionsChange: (mentions: string[]) => void;
  placeholder?: string;
};

export function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  placeholder,
}: MentionInputProps) {
  const orgId = useOrgId();
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: staffData } = useQuery<{ data: StaffMember[] }>({
    queryKey: ['staff-for-mentions', orgId],
    queryFn: async () => {
      const res = await fetch(buildPharmacistsApiPath(), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('スタッフの取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  const staffList: StaffMember[] = staffData?.data ?? [];

  const filteredStaff = searchQuery
    ? staffList.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : staffList;

  const insertMention = useCallback(
    (staff: StaffMember) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const textBefore = value.slice(0, cursorPos);
      const atIndex = textBefore.lastIndexOf('@');
      if (atIndex === -1) return;

      const before = value.slice(0, atIndex);
      const after = value.slice(cursorPos);
      const newValue = `${before}@${staff.name} ${after}`;

      onChange(newValue);
      if (!mentions.includes(staff.id)) {
        onMentionsChange([...mentions, staff.id]);
      }
      setShowDropdown(false);
      setSearchQuery('');

      requestAnimationFrame(() => {
        const newPos = atIndex + staff.name.length + 2;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
        textarea.focus();
      });
    },
    [value, mentions, onChange, onMentionsChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showDropdown) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredStaff.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredStaff.length - 1));
      } else if (e.key === 'Enter' && filteredStaff[selectedIndex]) {
        e.preventDefault();
        insertMention(filteredStaff[selectedIndex]);
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    },
    [showDropdown, filteredStaff, selectedIndex, insertMention],
  );

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    onChange(newValue);

    // 編集で `@表示名` が本文から消えた mention を除去する。
    // 名前を解決できる（staffList に存在する）mention のみ判定対象とし、
    // 解決できない mention（未ロードや既存コメント由来）は誤削除を避けて温存する。
    if (mentions.length > 0) {
      const nameById = new Map(staffList.map((s) => [s.id, s.name]));
      const nextMentions = mentions.filter((id) => {
        const name = nameById.get(id);
        if (name === undefined) return true;
        return isMentionDisplayPresent(newValue, name);
      });
      if (nextMentions.length !== mentions.length) {
        onMentionsChange(nextMentions);
      }
    }

    const cursorPos = e.target.selectionStart;
    const textBefore = newValue.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');

    if (
      atIndex !== -1 &&
      (atIndex === 0 || textBefore[atIndex - 1] === ' ' || textBefore[atIndex - 1] === '\n')
    ) {
      const query = textBefore.slice(atIndex + 1);
      if (!query.includes(' ') && !query.includes('\n')) {
        setSearchQuery(query);
        setShowDropdown(true);
        setSelectedIndex(0);
        return;
      }
    }
    setShowDropdown(false);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'コメントを入力... @でメンション'}
        rows={3}
        className="resize-none text-sm"
      />
      {showDropdown && filteredStaff.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 z-50 mb-1 max-h-40 w-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {filteredStaff.map((staff, index) => (
            <button
              key={staff.id}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                index === selectedIndex ? 'bg-muted' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(staff);
              }}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                {staff.name.charAt(0)}
              </span>
              <span>{staff.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
