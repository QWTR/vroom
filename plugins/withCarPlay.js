const {
  createRunOncePlugin,
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

    const manifest =
      plist.UIApplicationSceneManifest &&
      typeof plist.UIApplicationSceneManifest === 'object'
        ? plist.UIApplicationSceneManifest
        : {};
    const configurations =
      manifest.UISceneConfigurations &&
      typeof manifest.UISceneConfigurations === 'object'
        ? manifest.UISceneConfigurations
        : {};

    configurations.CPTemplateApplicationSceneSessionRoleApplication = [
      {
        UISceneClassName: 'CPTemplateApplicationScene',
        UISceneConfigurationName: 'VROOM CarPlay',
        UISceneDelegateClassName:
          '$(PRODUCT_MODULE_NAME).VroomCarPlayAppSceneDelegate',
      },
    ];
    manifest.UISceneConfigurations = configurations;
    plist.UIApplicationSceneManifest = manifest;
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
    withCarPlayEntitlements(withCarPlayInfoPlist(config)),
  );

const plugin = createRunOncePlugin(withCarPlay, 'with-vroom-carplay', '1.0.0');
plugin.__internal = {
  CARPLAY_SCENE_DELEGATE,
  withCarPlayInfoPlist,
  withCarPlayEntitlements,
};

module.exports = plugin;
