# Combined Markdown Content

## child.md

# child

Content goes here...

## THIS IS A CHANGE

---

## child2.md

# child2

Content goes here...

## THIS IS A CHANGE

---

## child3.md

# New Sample Page Title

This new paragraph includes **bold**, _italic_, <u>underline</u>, and ~~strikethrough~~.

Here is a [link](https://example.com), an 😄, and a mention @Madushika Pramod

- Bullet list item 1
- Bullet list item 2

1. Ordered list item 1
2. Ordered list item 2

- [ ] Task list item

> **Decision:** Decision list item

this table doesn't work

| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |

```javascript
console.log('Hello, world!');
```

> **Info:** This is an info panel.

> This is a blockquote.

---

> **Warning:** This is a warning panel.

> **Error:** This is an error panel.

**Date:** 2025-06-15

# Diagram Examples

This document demonstrates how to embed both **Mermaid** and **PlantUML** diagrams in a Markdown file.

---

## content2.md

# content2

Content goes here...

## THIS IS A CHANGE

---

## Default-topic.md

# This is the first topic

<!--Writerside adds this topic when you create a new documentation project.
You can use it as a sandbox to play with Writerside features, and remove it from the TOC when you don't need it anymore.
If you want to re-add it for your experiments, click + to create a new topic, choose Topic from Template, and select the 
"Starter" template.-->

## Add new topics
You can create empty topics, or choose a template for different types of content that contains some boilerplate structure to help you get started:

![Create new topic options](new_topic_options.png){ border-effect="line" thumbnail="true" width="321"}

## Write content
%product% supports two types of markup: Markdown and XML.
When you create a new help article, you can choose between two topic types, but this doesn't mean you have to stick to a single format.
You can author content in Markdown and extend it with semantic attributes or inject entire XML elements.

For example, this is how you inject a procedure:

<procedure title="Inject a procedure" id="inject-a-procedure">
    <step>
        <p>Start typing <code>procedure</code> and select a procedure type from the completion suggestions:</p>
        <img src="completion_procedure.png" alt="completion suggestions for procedure" border-effect="line"/>
    </step>
    <step>
        <p>Press <shortcut>Tab</shortcut> or <shortcut>Enter</shortcut> to insert the markup.</p>
    </step>
</procedure>

And here is how you can include a snippet from a library:

<include from="lib.md" element-id="sample"/>

## Add interactive elements

### Tabs
To add switchable content, use tabs (start typing `tabs` on a new line).

<tabs>
    <tab title="Markdown">
        <code-block lang="plain text">![Alt Text](new_topic_options.png){ width=450 }</code-block>
    </tab>
    <tab title="Semantic markup">
        <code-block lang="xml">
            <![CDATA[<img src="new_topic_options.png" alt="Alt text" width="450px"/>]]></code-block>
    </tab>
</tabs>

### Collapsible blocks
Besides injecting entire XML elements, you can use attributes to configure the behavior of certain elements.

---

## instance-2.md

# About Instance 2

Content goes here...

## THIS IS A CHANGE

---

## starter-topic.md

# About WriteSide Example

<!--Writerside adds this topic when you create a new documentation project.
You can use it as a sandbox to play with Writerside features, and remove it from the TOC when you don't need it anymore.-->

## Add new topics
You can create empty topics, or choose a template for different types of content that contains some boilerplate structure to help you get started:

![Create new topic options](new_topic_options.png){ width=290 }{border-effect=line}

## Write content
%product% supports two types of markup: Markdown and XML.
When you create a new help article, you can choose between two topic types, but this doesn't mean you have to stick to a single format.
You can author content in Markdown and extend it with semantic attributes or inject entire XML elements.

## Inject XML
For example, this is how you inject a procedure:

<procedure title="Inject a procedure" id="inject-a-procedure">
    <step>
        <p>Start typing and select a procedure type from the completion suggestions:</p>
        <img src="completion_procedure.png" alt="completion suggestions for procedure" border-effect="line"/>
    </step>
    <step>
        <p>Press <shortcut>Tab</shortcut> or <shortcut>Enter</shortcut> to insert the markup.</p>
    </step>
</procedure>

## Add interactive elements

### Tabs
To add switchable content, you can make use of tabs (inject them by starting to type `tab` on a new line):
<tabs>
    <tab title="Markdown">
        <code-block lang="plain text">![Alt Text](new_topic_options.png){ width=450 }</code-block>
    </tab>
    <tab title="Semantic markup">
        <code-block lang="xml">
            <![CDATA[<img src="new_topic_options.png" alt="Alt text" width="450px"/>]]></code-block>
    </tab>
</tabs>

### Collapsible blocks
Apart from injecting entire XML elements, you can use attributes to configure the behavior of certain elements.
For example, you can collapse a chapter that contains non-essential information:

#### Supplementary info {collapsible="true"}
Content under a collapsible header will be collapsed by default,
but you can modify the behavior by adding the following attribute:
`default-state="expanded"`
