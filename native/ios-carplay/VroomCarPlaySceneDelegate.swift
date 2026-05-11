import Foundation
import CarPlay

class VroomCarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  private var interfaceController: CPInterfaceController?
  private var rootTemplate: CPInformationTemplate?

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    showCurrentState()
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    self.interfaceController = nil
    self.rootTemplate = nil
  }

  private func showCurrentState() {
    let state = VroomCarPlayNavStore.shared.readState()
    let instruction = state?.nextInstruction.isEmpty == false
      ? state?.nextInstruction
      : "Brak aktywnej nawigacji"
    let distance = state?.remainingDistanceMeters != nil
      ? "\(state!.remainingDistanceMeters!) m"
      : "—"
    let eta = state?.remainingDurationSec != nil
      ? "\(state!.remainingDurationSec! / 60) min"
      : "—"

    let item = CPInformationItem(title: "Instrukcja", detail: instruction ?? "—")
    let itemDistance = CPInformationItem(title: "Pozostalo", detail: distance)
    let itemEta = CPInformationItem(title: "ETA", detail: eta)
    let template = CPInformationTemplate(
      title: "VROOM Navigation",
      layout: .leading,
      items: [item, itemDistance, itemEta],
      actions: [
        CPTextButton(title: "Stop", textStyle: .confirm) { _ in
          VroomCarPlayNavStore.shared.requestStop()
          self.showCurrentState()
        }
      ]
    )

    rootTemplate = template
    interfaceController?.setRootTemplate(template, animated: true, completion: nil)
  }
}
