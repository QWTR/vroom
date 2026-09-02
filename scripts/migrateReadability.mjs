import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const projectRoot = process.cwd();
const roots = ['app', 'components'];
const appTextPath = path.join(projectRoot, 'components', 'ui', 'AppText.tsx');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(absolute);
    return entry.isFile() && absolute.endsWith('.tsx') ? [absolute] : [];
  });
}

function relativeImport(fromFile) {
  let target = path.relative(path.dirname(fromFile), path.join(projectRoot, 'components', 'ui', 'AppText'));
  target = target.replaceAll('\\', '/');
  return target.startsWith('.') ? target : `./${target}`;
}

function migrateImports(file, source) {
  if (path.resolve(file) === path.resolve(appTextPath)) return source;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = parsed.statements.find((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === 'react-native'
  ));
  if (!declaration || !ts.isImportDeclaration(declaration)) return source;
  const clause = declaration.importClause;
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return source;

  const imported = new Set(clause.namedBindings.elements.map((element) => element.propertyName?.text ?? element.name.text));
  const usesText = imported.has('Text');
  const usesTextInput = imported.has('TextInput');
  if (!usesText && !usesTextInput) return source;

  const remaining = clause.namedBindings.elements.filter((element) => {
    const importedName = element.propertyName?.text ?? element.name.text;
    return importedName !== 'Text' && importedName !== 'TextInput';
  });
  const importParts = [];
  if (clause.name) importParts.push(clause.name.text);
  if (remaining.length) importParts.push(`{ ${remaining.map((element) => element.getText(parsed)).join(', ')} }`);
  const replacement = importParts.length ? `import ${importParts.join(', ')} from 'react-native';` : '';
  const readableNames = [usesText ? 'AppText as Text' : null, usesTextInput ? 'AppTextInput as TextInput' : null].filter(Boolean);
  const readableImport = `\nimport { ${readableNames.join(', ')} } from '${relativeImport(file)}';`;
  return source.slice(0, declaration.getStart(parsed)) + replacement + readableImport + source.slice(declaration.getEnd());
}

function clampNumericStyle(source, property, minimum) {
  const pattern = new RegExp(`(${property}\\s*:\\s*)(\\d+(?:\\.\\d+)?)`, 'g');
  return source.replace(pattern, (full, prefix, raw) => {
    const value = Number(raw);
    return value < minimum ? `${prefix}${minimum}` : full;
  });
}

function clampLetterSpacing(source) {
  return source.replace(/(letterSpacing\s*:\s*)(-?\d+(?:\.\d+)?)/g, (full, prefix, raw) => {
    const value = Number(raw);
    if (value > 1) return `${prefix}1`;
    if (value < -0.2) return `${prefix}-0.2`;
    return full;
  });
}

const files = roots.flatMap((root) => filesUnder(path.join(projectRoot, root)));
let changed = 0;
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let after = migrateImports(file, before);
  after = after
    .replaceAll("'OrbitronBold'", "'Manrope_700Bold'")
    .replaceAll('"OrbitronBold"', '"Manrope_700Bold"')
    .replaceAll("'Orbitron'", "'Manrope_600SemiBold'")
    .replaceAll('"Orbitron"', '"Manrope_600SemiBold"');
  after = clampNumericStyle(after, 'fontSize', 12);
  after = clampNumericStyle(after, 'lineHeight', 16);
  after = clampLetterSpacing(after);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed += 1;
  }
}

process.stdout.write(`Migrated ${changed} TSX files.\n`);
