import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const allowed: Readonly<Record<string, readonly string[]>> = {
  web: ['contracts', 'config', 'auth', 'domain', 'db'],
  contracts: [], config: ['contracts'], auth: ['contracts'],
  domain: ['auth', 'contracts'], db: ['domain'],
};
const serverPackages = new Set(['config', 'auth', 'domain', 'db']);
const namespace = '@weight-tracker/';

type PackageInfo = { directory: string; shortName: string; dependencies: Set<string> };
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.next', 'dist'].includes(entry.name)) return [];
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(ts|tsx|mjs)$/.test(file) ? [file] : [];
  });
}
function imports(source: ts.SourceFile): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) result.push(node.argument.literal.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const value = node.arguments[0];
      if (value && ts.isStringLiteral(value)) result.push(value.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
function inside(path: string, directory: string) {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

export function inspectBoundaries(root: string): string[] {
  const problems: string[] = [];
  const packages: PackageInfo[] = ['apps', 'packages'].flatMap(parent =>
    readdirSync(join(root, parent), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
      const directory = resolve(root, parent, entry.name);
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      return { directory, shortName: manifest.name.replace(namespace, ''), dependencies: new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) };
    }),
  );
  const files = packages.flatMap(pkg => sourceFiles(pkg.directory));
  const graph = new Map<string, string[]>();
  const clients: string[] = [];
  for (const pkg of packages) {
    for (const dependency of pkg.dependencies) {
      if (dependency.startsWith(namespace) && !allowed[pkg.shortName]?.includes(dependency.slice(namespace.length))) {
        problems.push(`${pkg.shortName}: forbidden dependency ${dependency}`);
      }
    }
    for (const file of files.filter(file => inside(file, pkg.directory))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const first = source.statements[0];
      if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client') clients.push(file);
      const targets: string[] = [];
      for (const specifier of imports(source)) {
        if (specifier.startsWith(namespace)) {
          if (!pkg.dependencies.has(specifier.split('/').slice(0, 2).join('/'))) problems.push(`${relative(root, file)}: undeclared workspace import ${specifier}`);
          const target = packages.find(value => specifier === `${namespace}${value.shortName}`);
          if (target) targets.push(join(target.directory, 'src/index.ts'));
          else problems.push(`${relative(root, file)}: unsupported workspace subpath ${specifier}`);
        } else if (specifier.startsWith('.')) {
          const path = resolve(dirname(file), specifier);
          const stem = path.replace(/\.m?js$/, '');
          const candidates = [path, `${stem}.ts`, `${stem}.tsx`, join(path, 'index.ts'), join(path, 'index.tsx')];
          const target = files.find(candidate => candidates.includes(candidate));
          if (!inside(path, pkg.directory)) problems.push(`${relative(root, file)}: relative import escapes package (${specifier})`);
          if (target) targets.push(target);
        } else if (specifier.includes('references/')) {
          problems.push(`${relative(root, file)}: historical reference import forbidden`);
        }
      }
      graph.set(file, targets);
    }
  }
  for (const client of clients) {
    const visited = new Set<string>();
    const walk = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      const pkg = packages.find(value => inside(file, value.directory));
      if (pkg && serverPackages.has(pkg.shortName)) problems.push(`${relative(root, client)}: client reaches server package ${pkg.shortName}`);
      for (const target of graph.get(file) ?? []) walk(target);
    };
    walk(client);
  }
  return problems;
}
