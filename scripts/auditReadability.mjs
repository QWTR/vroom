import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const scanRoots = ['app', 'components', 'constants', 'contexts'];
const appTextFile = path.normalize(path.join(root, 'components', 'ui', 'AppText.tsx'));
const findings = [];

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(absolute);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [absolute] : [];
  });
}

function location(sourceFile, position) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return `${path.relative(root, sourceFile.fileName).replaceAll('\\', '/')}:${line + 1}:${character + 1}`;
}

function report(sourceFile, node, message) {
  findings.push(`${location(sourceFile, node.getStart(sourceFile))} ${message}`);
}

for (const scanRoot of scanRoots) {
  const directory = path.join(root, scanRoot);
  if (!fs.existsSync(directory)) continue;
  for (const file of filesUnder(directory)) {
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    if (/Orbitron/i.test(text)) {
      findings.push(`${path.relative(root, file).replaceAll('\\', '/')} still references Orbitron`);
    }

    function visit(node) {
      if (
        ts.isImportDeclaration(node)
        && ts.isStringLiteral(node.moduleSpecifier)
        && (node.moduleSpecifier.text === 'react-native' || node.moduleSpecifier.text === '@react-navigation/elements')
      ) {
        const bindings = node.importClause?.namedBindings;
        if (path.normalize(file) !== appTextFile && bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === 'Text' || importedName === 'TextInput') {
              report(sourceFile, element, `imports raw ${importedName} from ${node.moduleSpecifier.text}; use AppText${importedName === 'TextInput' ? 'Input' : ''}`);
            }
          }
        }
      }

      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        if (node.name.text === 'fontSize' && ts.isNumericLiteral(node.initializer) && Number(node.initializer.text) < 12) {
          report(sourceFile, node, `uses fontSize ${node.initializer.text}; minimum is 12`);
        }
        if (node.name.text === 'fontFamily' && /Orbitron/i.test(node.initializer.getText(sourceFile))) {
          report(sourceFile, node, 'uses the retired Orbitron font');
        }
      }

      if (ts.isJsxAttribute(node) && node.name.text === 'adjustsFontSizeToFit') {
        report(sourceFile, node, 'can shrink text below the readable minimum');
      }

      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
}

if (findings.length) {
  process.stderr.write(`Readability audit failed (${findings.length} findings):\n${findings.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Readability audit passed: Manrope/AppText only, no font below 12, no automatic shrink-to-fit.\n');
