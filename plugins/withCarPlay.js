const {
  createRunOncePlugin,
  withAppDelegate,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getHackyProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');

const CARPLAY_SCENE_DELEGATE = `import CarPlay
import UIKit
import VroomCarPlay

final class VroomCarPlayAppSceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    VroomCarPlayCoordinator.shared.connect(
      interfaceController: interfaceController,
      window: window
    )
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    VroomCarPlayCoordinator.shared.disconnect()
  }
}
`;

const CARPLAY_APP_DELEGATE_METHOD = `
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "VROOM CarPlay",
      sessionRole: connectingSceneSession.role
    )
    if connectingSceneSession.role ==
      UISceneSession.Role.carTemplateApplication
    {
      configuration.sceneClass = CPTemplateApplicationScene.self
      configuration.delegateClass = VroomCarPlayAppSceneDelegate.self
    }
    return configuration
  }
`;

const insertSwiftClassMember = (source, className, member, marker) => {
  if (source.includes(marker)) {
    return source;
  }
  const classIndex = source.search(
    new RegExp(`(?:public\\s+)?class\\s+${className}\\b`),
  );
  if (classIndex < 0) {
    throw new Error(`Cannot find ${className} in the generated AppDelegate`);
  }
  const openingBrace = source.indexOf('{', classIndex);
  if (openingBrace < 0) {
    throw new Error(`Cannot find the ${className} class body`);
  }
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return `${source.slice(0, index)}${member}\n${source.slice(index)}`;
      }
    }
  }
  throw new Error(`Cannot find the end of ${className}`);
};

const withCarPlayInfoPlist = (config) =>
  withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    const existingModes = Array.isArray(plist.UIBackgroundModes)
      ? plist.UIBackgroundModes
      : [];
    plist.UIBackgroundModes = Array.from(new Set([...existingModes, 'location']));
    plist.UISupportsCarPlay = true;
    plist.MBXAccessToken =
      process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
      plist.MBXAccessToken ||
      'pk.eyJ1IjoicDFrM3kiLCJhIjoiY21vMWx4Ym14MDZzdzJyc2VmOW1jNmNuaCJ9.hvV-mM6a1--RhnJqlMkojg';

    // Expo owns the phone lifecycle through AppDelegate. A CarPlay-only scene
    // manifest would switch the phone app to UIScene without providing a
    // UIWindowScene delegate, which can terminate the app during launch.
    const manifest = plist.UIApplicationSceneManifest;
    const configurations = manifest?.UISceneConfigurations;
    if (configurations && typeof configurations === 'object') {
      delete configurations.CPTemplateApplicationSceneSessionRoleApplication;
      if (Object.keys(configurations).length === 0) {
        delete manifest.UISceneConfigurations;
      }
    }
    if (
      manifest &&
      typeof manifest === 'object' &&
      Object.keys(manifest).length === 0
    ) {
      delete plist.UIApplicationSceneManifest;
    }
    return cfg;
  });

const withCarPlayAppDelegate = (config) =>
  withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('VROOM CarPlay requires a Swift AppDelegate');
    }
    let contents = cfg.modResults.contents;
    if (!contents.includes('import CarPlay')) {
      contents = `import CarPlay\n${contents}`;
    }
    contents = insertSwiftClassMember(
      contents,
      'AppDelegate',
      CARPLAY_APP_DELEGATE_METHOD,
      'configurationForConnecting connectingSceneSession',
    );
    cfg.modResults.contents = contents;
    return cfg;
  });

const withCarPlayEntitlements = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.carplay-maps'] = true;
    delete cfg.modResults['com.apple.developer.carplay-navigation'];
    return cfg;
  });

const withCarPlaySceneDelegate = (config) =>
  withXcodeProject(config, (cfg) => {
    const projectName = getHackyProjectName(
      cfg.modRequest.platformProjectRoot,
      cfg,
    );
    cfg.modResults = createBuildSourceFile({
      project: cfg.modResults,
      nativeProjectRoot: cfg.modRequest.platformProjectRoot,
      filePath: `${projectName}/VroomCarPlayAppSceneDelegate.swift`,
      fileContents: CARPLAY_SCENE_DELEGATE,
      overwrite: true,
    });
    cfg.modResults.addBuildProperty('SWIFT_VERSION', '5.9');
    return cfg;
  });

const withCarPlay = (config) =>
  withCarPlaySceneDelegate(
    withCarPlayAppDelegate(
      withCarPlayEntitlements(withCarPlayInfoPlist(config)),
    ),
  );

const plugin = createRunOncePlugin(withCarPlay, 'with-vroom-carplay', '1.0.1');
plugin.__internal = {
  CARPLAY_SCENE_DELEGATE,
  CARPLAY_APP_DELEGATE_METHOD,
  insertSwiftClassMember,
  withCarPlayInfoPlist,
  withCarPlayEntitlements,
};

module.exports = plugin;
