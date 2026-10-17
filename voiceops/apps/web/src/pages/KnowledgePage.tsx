import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Textarea } from "../components/ui";

interface Item {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  active: boolean;
}
interface Gap {
  id: string;
  question: string;
  count: number;
  lastAskedAt: string;
}

export function KnowledgePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["knowledge"], queryFn: () => api.get<{ items: Item[]; gaps: Gap[] }>("/api/v1/knowledge") });
  const [editing, setEditing] = useState<Partial<Item> & { resolveGapId?: string } | null>(null);
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/knowledge/gaps/${id}/dismiss`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });

  return (
    <div>
      <PageHeader
        title="Knowledge"
        sub="The receptionist only answers questions from this list. If something isn't here, it says it doesn't know and offers a call back."
        actions={<Button variant="primary" onClick={() => setEditing({ tags: [] })}>Add an answer</Button>}
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data && (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <Panel title={`Answers (${q.data.items.length})`}>
            {q.data.items.length === 0 ? (
              <Empty title="No answers yet">Add the questions your staff hear every day: parking, payment, pickup, warranty.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {q.data.items.map((it) => (
                  <li key={it.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{it.question} {!it.active && <Badge>Hidden</Badge>}</div>
                        <p className="mt-0.5 text-sm text-ink-soft">{it.answer}</p>
                        {it.tags.length > 0 && <p className="mt-1 text-xs text-muted">Also matches: {it.tags.join(", ")}</p>}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>Edit</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Questions it couldn't answer">
            {q.data.gaps.length === 0 ? (
              <Empty title="None so far">Questions callers ask that aren't covered show up here, most-asked first.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {q.data.gaps.map((g) => (
                  <li key={g.id} className="px-4 py-3">
                    <p className="text-sm font-medium">"{g.question}"</p>
                    <p className="text-xs text-muted">Asked {g.count} {g.count === 1 ? "time" : "times"}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => setEditing({ question: g.question, tags: [], resolveGapId: g.id })}>Write an answer</Button>
                      <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(g.id)}>Ignore</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
      {editing && <Editor item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Editor({ item, onClose }: { item: Partial<Item> & { resolveGapId?: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState(item.question ?? "");
  const [answer, setAnswer] = useState(item.answer ?? "");
  const [tags, setTags] = useState((item.tags ?? []).join(", "));
  const save = useMutation({
    mutationFn: () => {
      const body = { question, answer, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), resolveGapId: item.resolveGapId };
      return item.id ? api.patch(`/api/v1/knowledge/${item.id}`, body) : api.post("/api/v1/knowledge", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/v1/knowledge/${item.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Modal open onClose={onClose} title={item.id ? "Edit answer" : "Add an answer"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Question">{(id) => <Input id={id} value={question} onChange={(e) => setQuestion(e.target.value)} required minLength={3} />}</Field>
        <Field label="Answer" hint="Write it the way you'd say it on the phone: one or two short sentences.">
          {(id) => <Textarea id={id} value={answer} onChange={(e) => setAnswer(e.target.value)} required />}
        </Field>
        <Field label="Other words callers use" hint="Comma separated, Hindi words welcome: pickup, ghar se, collect">
          {(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} />}
        </Field>
        <ErrorNote error={save.error ?? remove.error} />
        <div className="flex justify-between gap-2">
          {item.id ? <Button type="button" variant="danger" onClick={() => remove.mutate()} busy={remove.isPending}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={save.isPending}>Save answer</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
