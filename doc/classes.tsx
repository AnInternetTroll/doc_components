// Copyright 2021-2022 the Deno authors. All rights reserved. MIT license.

/** @jsx runtime.h */
/** @jsxFrag runtime.Fragment */
import {
  type ClassConstructorDef,
  type ClassMethodDef,
  type ClassPropertyDef,
  type DocNodeClass,
  tw,
} from "../deps.ts";
import {
  DocEntry,
  getAccessibilityTag,
  nameToId,
  Section,
  Tag,
  tagVariants,
} from "./doc_common.tsx";
import { IndexSignaturesDoc } from "./interfaces.tsx";
import { type MarkdownContext } from "./markdown.tsx";
import { Params } from "./params.tsx";
import { runtime } from "../services.ts";
import { style } from "../styles.ts";
import { TypeDef, TypeParamsDoc } from "./types.tsx";
import { assert, type Child, isDeprecated, take } from "./utils.ts";
import { DocFunctionSummary } from "./functions.tsx";

type ClassAccessorDef = ClassMethodDef & { kind: "getter" | "setter" };
type ClassGetterDef = ClassMethodDef & { kind: "getter" };
type ClassSetterDef = ClassMethodDef & { kind: "setter" };
type ClassItemDef = ClassMethodDef | ClassPropertyDef;

function compareAccessibility(
  a: ClassPropertyDef | ClassMethodDef,
  b: ClassPropertyDef | ClassMethodDef,
): number {
  if (a.accessibility !== b.accessibility) {
    if (a.accessibility === "private") {
      return -1;
    }
    if (b.accessibility === "private") {
      return 1;
    }
    if (a.accessibility === "protected") {
      return -1;
    }
    if (b.accessibility === "protected") {
      return 1;
    }
  }
  if (a.name === b.name && isClassAccessor(a) && isClassAccessor(b)) {
    return a.kind === "getter" ? -1 : 1;
  }
  if (a.name.startsWith("[") && b.name.startsWith("[")) {
    return a.name.localeCompare(b.name);
  }
  if (a.name.startsWith("[")) {
    return 1;
  }
  if (b.name.startsWith("[")) {
    return -1;
  }
  return a.name.localeCompare(b.name);
}

function getClassItems({ classDef: { properties, methods } }: DocNodeClass) {
  return [...properties, ...methods].sort((a, b) => {
    if (a.isStatic !== b.isStatic) {
      return a.isStatic ? 1 : -1;
    }
    if (
      (isClassProperty(a) && isClassProperty(b)) ||
      (isClassProperty(a) && isClassAccessor(b)) ||
      (isClassAccessor(a) && isClassProperty(b)) ||
      (isClassAccessor(a) && isClassAccessor(b)) ||
      (isClassMethod(a) && isClassMethod(b))
    ) {
      return compareAccessibility(a, b);
    }
    if (isClassAccessor(a) && !isClassAccessor(b)) {
      return -1;
    }
    if (isClassAccessor(b)) {
      return 1;
    }
    return isClassProperty(a) ? -1 : 1;
  });
}

function isClassAccessor(
  value: ClassPropertyDef | ClassMethodDef,
): value is ClassAccessorDef {
  return "kind" in value &&
    (value.kind === "getter" || value.kind === "setter");
}

function isClassGetter(
  value: ClassPropertyDef | ClassMethodDef,
): value is ClassGetterDef {
  return "kind" in value && value.kind === "getter";
}

function isClassMethod(
  value: ClassPropertyDef | ClassMethodDef,
): value is ClassMethodDef & { kind: "method" } {
  return "kind" in value && value.kind === "method";
}

function isClassProperty(
  value: ClassPropertyDef | ClassMethodDef,
): value is ClassPropertyDef {
  return "readonly" in value;
}

function isClassSetter(
  value: ClassPropertyDef | ClassMethodDef,
): value is ClassSetterDef {
  return "kind" in value && value.kind === "setter";
}

function ClassAccessorDoc(
  { get, set, markdownContext }: {
    get?: ClassGetterDef;
    set?: ClassSetterDef;
    markdownContext: MarkdownContext;
  },
) {
  const name = (get ?? set)?.name;
  assert(name);
  const id = nameToId("accessor", name);
  const tsType = get?.functionDef.returnType ??
    set?.functionDef.params[0]?.tsType;
  const jsDoc = get?.jsDoc ?? set?.jsDoc;
  const location = get?.location ?? set?.location;
  assert(location);
  const accessibility = get?.accessibility ?? set?.accessibility;
  const isAbstract = get?.isAbstract ?? set?.isAbstract;
  const tags = [];

  const accessibilityTag = getAccessibilityTag(accessibility);
  if (accessibilityTag) {
    tags.push(accessibilityTag);
  }

  if (isAbstract) {
    tags.push(tagVariants.abstract());
  }
  if (isDeprecated(get ?? set)) {
    tags.push(tagVariants.deprecated());
  }

  if (get && !set) {
    tags.push(tagVariants.readonly());
  } else if (!get && set) {
    tags.push(tagVariants.writeonly());
  }

  return (
    <DocEntry
      id={id}
      location={location}
      tags={tags}
      name={name}
      jsDoc={jsDoc}
      markdownContext={markdownContext}
    >
      {tsType && (
        <span>
          :{" "}
          <span class={tw`font-medium`}>
            <TypeDef markdownContext={markdownContext}>{tsType}</TypeDef>
          </span>
        </span>
      )}
    </DocEntry>
  );
}

function ClassMethodDoc(
  { children, markdownContext }: {
    children: Child<ClassMethodDef[]>;
    markdownContext: MarkdownContext;
  },
) {
  const defs = take(children, true);
  const items = defs.map((
    {
      location,
      name,
      jsDoc,
      accessibility,
      optional,
      isAbstract,
      functionDef,
    },
    i,
  ) => {
    const id = nameToId("method", `${defs[0].name}_${i}`);

    const tags = [];
    const accessibilityTag = getAccessibilityTag(accessibility);
    if (accessibilityTag) {
      tags.push(accessibilityTag);
    }

    if (isAbstract) {
      tags.push(tagVariants.abstract());
    }
    if (optional) {
      tags.push(tagVariants.optional());
    }
    if (isDeprecated({ jsDoc })) {
      tags.push(tagVariants.deprecated());
    }

    return (
      <DocEntry
        id={id}
        tags={tags}
        location={location}
        name={name}
        jsDoc={jsDoc}
        markdownContext={markdownContext}
      >
        <DocFunctionSummary markdownContext={markdownContext}>
          {functionDef}
        </DocFunctionSummary>
      </DocEntry>
    );
  });

  return <>{items}</>;
}

function ClassPropertyDoc(
  { children, markdownContext }: {
    children: Child<ClassPropertyDef>;
    markdownContext: MarkdownContext;
  },
) {
  const {
    location,
    name,
    tsType,
    jsDoc,
    accessibility,
    isAbstract,
    optional,
    readonly,
  } = take(children);
  const id = nameToId("prop", name);

  const tags = [];
  const accessibilityTag = getAccessibilityTag(accessibility);
  if (accessibilityTag) {
    tags.push(accessibilityTag);
  }
  if (isAbstract) {
    tags.push(tagVariants.abstract());
  }
  if (readonly) {
    tags.push(tagVariants.readonly());
  }
  if (optional) {
    tags.push(tagVariants.optional());
  }
  if (isDeprecated({ jsDoc })) {
    tags.push(tagVariants.deprecated());
  }

  return (
    <DocEntry
      id={id}
      location={location}
      tags={tags}
      name={name}
      jsDoc={jsDoc}
      markdownContext={markdownContext}
    >
      {tsType && (
        <span>
          : <TypeDef markdownContext={markdownContext}>{tsType}</TypeDef>
        </span>
      )}
    </DocEntry>
  );
}

function ClassItemsDoc(
  { children, markdownContext }: {
    children: Child<ClassItemDef[]>;
    markdownContext: MarkdownContext;
  },
) {
  const defs = take(children, true);
  if (!defs.length) {
    return <></>;
  }

  const properties: unknown[] = [];
  const methods: unknown[] = [];
  const staticProperties: unknown[] = [];
  const staticMethods: unknown[] = [];

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (isClassGetter(def)) {
      const next = defs[i + 1];
      if (next && isClassSetter(next) && def.name === next.name) {
        i++;
        (def.isStatic ? staticProperties : properties).push(
          <ClassAccessorDoc
            get={def}
            set={next}
            markdownContext={markdownContext}
          />,
        );
      } else {
        (def.isStatic ? staticProperties : properties).push(
          <ClassAccessorDoc get={def} markdownContext={markdownContext} />,
        );
      }
    } else if (isClassSetter(def)) {
      (def.isStatic ? staticProperties : properties).push(
        <ClassAccessorDoc set={def} markdownContext={markdownContext} />,
      );
    } else if (isClassMethod(def)) {
      const methodList = [def];
      let next;
      while (
        (next = defs[i + 1]) && next && isClassMethod(next) &&
        def.name === next.name
      ) {
        i++;
        methodList.push(next);
      }
      (def.isStatic ? staticMethods : methods).push(
        <ClassMethodDoc markdownContext={markdownContext}>
          {methodList}
        </ClassMethodDoc>,
      );
    } else {
      assert(isClassProperty(def));
      (def.isStatic ? staticProperties : properties).push(
        <ClassPropertyDoc markdownContext={markdownContext}>
          {def}
        </ClassPropertyDoc>,
      );
    }
  }

  return (
    <>
      {properties.length !== 0 && (
        <Section title="Properties">{properties}</Section>
      )}
      {methods.length !== 0 && <Section title="Methods">{methods}</Section>}
      {staticProperties.length !== 0 && (
        <Section title="Static Properties">{staticProperties}</Section>
      )}
      {staticMethods.length !== 0 && (
        <Section title="Static Methods">{staticMethods}</Section>
      )}
    </>
  );
}

function ConstructorsDoc(
  { children, name, markdownContext }: {
    children: Child<ClassConstructorDef[]>;
    name: string;
    markdownContext: MarkdownContext;
  },
) {
  const defs = take(children, true);
  if (!defs.length) {
    return null;
  }
  const items = defs.map(({ location, params, jsDoc, accessibility }, i) => {
    const id = nameToId("ctor", String(i));
    return (
      <DocEntry
        id={id}
        location={location}
        tags={[
          <Tag color="purple">new</Tag>,
          getAccessibilityTag(accessibility),
        ]}
        name={name}
        jsDoc={jsDoc}
        markdownContext={markdownContext}
      >
        (<Params markdownContext={markdownContext}>
          {params}
        </Params>)
      </DocEntry>
    );
  });

  return <Section title="Constructors">{items}</Section>;
}

export function DocSubTitleClass(
  { children, markdownContext }: {
    children: Child<DocNodeClass>;
    markdownContext: MarkdownContext;
  },
) {
  const { classDef } = take(children);

  return (
    <>
      {classDef.implements.length !== 0 && (
        <div>
          <span class={tw`text-[#9CA0AA] italic`}>{" implements "}</span>
          {classDef.implements.map((typeDef, i) => (
            <>
              <TypeDef markdownContext={markdownContext}>{typeDef}</TypeDef>
              {i !== (classDef.implements.length - 1) && <span>,{" "}</span>}
            </>
          ))}
        </div>
      )}

      {classDef.extends && (
        <div>
          <span class={tw`text-[#9CA0AA] italic`}>{" extends "}</span>
          <span>{classDef.extends}</span>
          <span>
            {classDef.superTypeParams.length !== 0 && (
              <span>
                {"<"}
                {classDef.superTypeParams.map((typeDef, i) => (
                  <>
                    <TypeDef markdownContext={markdownContext}>
                      {typeDef}
                    </TypeDef>
                    {i !== (classDef.superTypeParams.length - 1) && (
                      <span>,{" "}</span>
                    )}
                  </>
                ))}
                {">"}
              </span>
            )}
          </span>
        </div>
      )}
    </>
  );
}

export function DocBlockClass(
  { children, markdownContext }: {
    children: Child<DocNodeClass>;
    markdownContext: MarkdownContext;
  },
) {
  const def = take(children);
  const classItems = getClassItems(def);
  return (
    <div class={style("docBlockItems")}>
      <ConstructorsDoc name={def.name} markdownContext={markdownContext}>
        {def.classDef.constructors}
      </ConstructorsDoc>

      <TypeParamsDoc base={def} markdownContext={markdownContext}>
        {def.classDef.typeParams}
      </TypeParamsDoc>

      <IndexSignaturesDoc markdownContext={markdownContext}>
        {def.classDef.indexSignatures}
      </IndexSignaturesDoc>

      <ClassItemsDoc markdownContext={markdownContext}>
        {classItems}
      </ClassItemsDoc>
    </div>
  );
}
