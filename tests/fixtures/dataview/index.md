# Dataview Index

```dataview
TABLE status, priority, file.name AS note
FROM "notes"
WHERE status = "open"
SORT priority DESC
LIMIT 2
```

Open count: = length(file.tasks)

```dataview
TASK
FROM "notes"
WHERE !completed
```
