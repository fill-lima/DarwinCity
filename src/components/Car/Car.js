import *as THREE from 'three';
import gsap from 'gsap';

import CarModel from './CarModel';
import CarSensor from './CarSensor';
import Navigation from '../../services/Navigation';
import utils from '../../helpers/utils';
import TrafficLight from '../Road/TrafficLight';
import RoadPath from '../Road/RoadPath';

class Car {
  constructor(props) {
    const {
      position,
      angle
    } = props;

    this.broken = false;
    this.position = {
      x: 0,
      y: 0
    };
    this.state = null;
    this.handleAngle = 0;
    this.color = utils.getRandomColor();
    this.mesh = CarModel.create3dModel(this.color);
    this.hitboxMesh = this.mesh.children.find((mesh) => mesh.name === 'hitbox');
    this.mesh.rotation.x = -Math.PI / 2;

    this.setPosition(position.x, position.y);
    this.setAngle(angle);

    this.route = [];
    this.routeIdx = null;

    this.detailedRoute = [];
    this.detailedRouteIdx = null;

    this.navigation = Navigation;
    this.currentRouteTargetNode = null;
    this.currentRoadPath = null;

    this.velocity = 0;
    this.brakePower = 0.1;
    this.accelerationPower = 0.01;

    this.maxVelocity = utils.getRandomInt(15, 20) / 10;
    this.callbacks = {
      onBrake: () => {},
      onArrival: () => {}
    };

    this.sensors = {};

    [
      ['front', 0],
      ['left', 90],
      ['right', -90],
      ['fleft', 45],
      ['fright', -45],
      ['rleft', 135],
      ['rright', -135]
    ].forEach((sensorData) => {
      this.sensors[sensorData[0]] = new CarSensor({
        name: sensorData[0],
        car: this,
        angle: sensorData[1],
        near: CarModel.carSize / 2,
        far: this.getStoppingDistance(this.maxVelocity) + (CarModel.carSize / 2) + 10
      });
    });
    this.mesh.add(this.sensors.front.line);
    this.mesh.add(this.sensors.left.line);
    this.mesh.add(this.sensors.right.line);
    this.mesh.add(this.sensors.fleft.line);
    this.mesh.add(this.sensors.fright.line);
    this.mesh.add(this.sensors.rleft.line);
    this.mesh.add(this.sensors.rright.line);
  }

  getLeftDistanceToEnd() {
    let leftDistance = this.mesh.position.distanceTo(this.route[this.routeIdx].vector3);

    for(let i = this.routeIdx + 1; i < this.route.length; i++) {
      leftDistance += this.route[i - 1].vector3.distanceTo(this.route[i].vector3);
    }

    return leftDistance;
  }

  getStoppingDistance(velocity) {
    let tmpVelocity = velocity;
    let stoppingDistance = 0;
    while(tmpVelocity > 0) {
      tmpVelocity -= this.brakePower;
      stoppingDistance += tmpVelocity;
    }
    return stoppingDistance;
  }

  setPosition(x, y) {
    this.position.x = x;
    this.position.y = y;
    this.mesh.position.set(x, 0, y);
  }

  setAngle(angle) {
    this.angle = angle;
    this.mesh.rotation.z = utils.angleToRadians(this.angle - 90);
  }

  calculateNextPosition() {
    const {x, y} = this.position;
    const radians = utils.angleToRadians(this.angle);
    const newX = utils.roundNumber(x + Math.cos(radians) * this.velocity, 1);
    const newY = utils.roundNumber(y - Math.sin(radians) * this.velocity, 1);
    this.setPosition(newX, newY);
  }

  setRoute(routePath, callbacks) {
    this.route = routePath;
    this.routeIdx = 0;
    this.currentRoadPath = this.route[this.routeIdx].roadPath;

    this.updateDetailedRoute();

    this.callbacks.onArrival = callbacks.onArrival;
    this.callbacks.onBrake = callbacks.onBrake;
  }

  accelerate() {
    const nextVelocity = this.velocity + this.accelerationPower;
    if(nextVelocity > this.maxVelocity) {
      this.velocity = this.maxVelocity;
      return;
    }

    this.velocity = nextVelocity;
  }

  brake() {
    const nextVelocity = this.velocity - this.brakePower;
    if(nextVelocity < 0) {
      this.velocity = 0;
      return;
    }

    this.velocity = nextVelocity;
  }

  // nextDetailedRoute() {
  //   const routeNode = this.route[this.routeIdx];
  //   const routeNodeIdx = this.currentTargetNode.nextPoints.indexOf(routeNode);

  //   if(routeNodeIdx !== -1) {
  //     this.currentTargetNode = routeNode;
  //     return;
  //   }

  //   // eslint-disable-next-line prefer-destructuring
  //   this.currentTargetNode = this.currentTargetNode.nextPoints[0];
  // }

  onArriveDetailedRoute() {
    const detailedRouteNode = this.detailedRoute[this.detailedRouteIdx];
    const nextDetailedRouteNode = this.detailedRoute[this.detailedRouteIdx + 1];

    if(!nextDetailedRouteNode) {
      this.onArriveRoute();
      return;
    }

    this.detailedRouteIdx++;

    if(detailedRouteNode.beforeLaneChange) {
      this.currentRoadPath = nextDetailedRouteNode.roadPath;
    }

    if(detailedRouteNode.laneChange) {
      this.currentRoadPath = detailedRouteNode.roadPath;
    }
  }

  onArriveRoute() {
    const currentRouteNode = this.route[this.routeIdx];
    const nextRouteNode = this.route[this.routeIdx + 1];

    if(!nextRouteNode) {
      this.route = [];
      this.routeIdx = null;
      this.detailedRoute = [];
      this.detailedRouteIdx = null;
      setTimeout(() => {
        this.callbacks.onArrival(this);
      });
      return;
    }

    this.routeIdx++;
    const isDifferentWay = currentRouteNode.roadPath.way !== nextRouteNode.roadPath.way;

    if(isDifferentWay) {
      const nextWayNode = currentRouteNode.nextPoints[0];
      this.currentRoadPath = nextWayNode.roadPath;
      this.updateDetailedRoute(nextWayNode);
      return;
    }

    this.updateDetailedRoute(currentRouteNode);
  }

  break() {
    if(this.broken) {
      return;
    }

    const _this = this;
    const materials = {
      gray: new THREE.MeshBasicMaterial({color: 0xAEAEAE}),
      black: new THREE.MeshBasicMaterial({color: 0x222222})
    };

    const initial = new THREE.Color(materials.gray.color.getHex());
    const value = new THREE.Color(materials.black.color.getHex());

    gsap.to(initial, 1, {
      r: value.r,
      g: value.g,
      b: value.b,

      onUpdate() {
        _this.mesh.children.forEach((mesh) => {
          if(mesh.name === 'sensor') {
            return;
          }

          mesh.material.color = initial;
        });
      },
      onComplete() {
        _this.callbacks.onBrake(_this);
      }
    });

    this.broken = true;
  }

  resetSensors() {
    Object.keys(this.sensors).forEach((sensorPos) => this.sensors[sensorPos].reset());
  }

  checkCollision(collidableList) {
    if(this.broken || this.routeIdx === null) {
      return;
    }

    this.resetSensors();

    // Hit check
    const collidableMeshList = collidableList
      .filter((obj) => {
        if(obj instanceof TrafficLight && obj.state !== 'red') {
          return false;
        }

        return true;
      })
      .map((obj) => obj.hitboxMesh);

    const collisions = utils.checkCollision(this.hitboxMesh, collidableMeshList);
    if(collisions.length) {
      this.break();
      collisions.forEach((collision) => {
        if(collision.object.name === 'traffic_light_hitbox') {
          return;
        }

        collidableList[collidableMeshList.indexOf(collision.object)].break();
      });
    }

    // Sensors check
    this.sensors.front.update(collidableList);

    const sensorCollidableList = collidableList
      .filter((obj) => !(obj instanceof Car) || (obj instanceof Car && obj.currentRoadPath === this.currentRoadPath));
    this.sensors.fleft.update(sensorCollidableList);
    this.sensors.fright.update(sensorCollidableList);

    let detailRouteNode = this.detailedRoute[this.detailedRouteIdx];
    if(detailRouteNode.beforeLaneChange) {
      detailRouteNode = this.detailedRoute[this.detailedRouteIdx + 1];
    }

    if(detailRouteNode.laneChange) {
      const sideSensorCollidableList = collidableList
        .filter((obj) => obj instanceof Car && obj.currentRoadPath === detailRouteNode.roadPath);
      this.sensors[detailRouteNode.direction].update(sideSensorCollidableList);
      this.sensors[`r${detailRouteNode.direction}`].update(sideSensorCollidableList);
    }
  }

  setAngleTo(targetX, targetY) {
    const {x, y} = this.position;

    const deltaX = utils.roundNumber(targetX - x, 1);
    const deltaY = utils.roundNumber((targetY - y) * -1, 1);

    const bestAngle = utils.calcAngleDegrees(deltaX, deltaY);

    if(bestAngle !== this.angle) {
      this.setAngle(bestAngle);
    }
  }

  updateDetailedRoute(lastPassedNode) {
    const routeNode = this.route[this.routeIdx];

    if(!lastPassedNode) {
      this.detailedRoute = [this.route[this.routeIdx]];
      this.detailedRouteIdx = 0;
      return;
    }

    if(routeNode.roadPath !== this.currentRoadPath) {
      this.detailedRoute = this.getChangeLaneRoute(routeNode.roadPath.order > this.currentRoadPath.order ? 'right' : 'left');
      this.detailedRouteIdx = 0;
      return;
    }

    this.detailedRoute = RoadPath.getPathUntilNode(lastPassedNode, this.route[this.routeIdx]);
    this.detailedRouteIdx = 0;
  }

  calculateCarReaction() {
    const endDistance = this.getLeftDistanceToEnd();
    const distanceToStop = this.getStoppingDistance(this.velocity);
    const detailedRouteNode = this.detailedRoute[this.detailedRouteIdx];

    if(this.sensors.front.distance !== null) {
      this.brake();
      return;
    }

    let sensorMinDist = null;
    let sensorMin = null;
    Object.keys(this.sensors).forEach((sensorDirection) => {
      if(this.sensors[sensorDirection].distance === null) {
        return;
      }

      if(!sensorMinDist || this.sensors[sensorDirection].distance < sensorMinDist) {
        sensorMin = this.sensors[sensorDirection];
        sensorMinDist = sensorMin.distance;
      }
    });

    if(sensorMin) {
      if(sensorMin.collisionObj instanceof Car && (this.velocity > sensorMin.collisionObj.velocity || !sensorMin.collisionObj.velocity)) {
        this.setAngleTo(detailedRouteNode.x, detailedRouteNode.y);
        this.accelerate();
      } else {
        this.brake();
      }
      return;
    }

    if(endDistance <= distanceToStop) {
      this.brake();
    } else {
      this.setAngleTo(detailedRouteNode.x, detailedRouteNode.y);
      this.accelerate();
    }
  }

  getChangeLaneRoute(direction) {
    const targetRoadPath = this.route[this.routeIdx].roadPath;
    const mod = direction === 'right' ? -1 : 1;
    const roadPathAngle = this.currentRoadPath.getAngle();
    let newAngle = roadPathAngle + (45 * mod);
    if(newAngle > 180) {
      newAngle = -360 + newAngle;
    }

    if(newAngle < -180) {
      newAngle = 360 + newAngle;
    }

    const {x, y} = this.position;
    const crossRoadPathsLen = Math.abs(this.currentRoadPath.order - targetRoadPath.order);
    const changingLaneNodes = [];
    let tempRoadPath;
    let tempRoadPathDeepestNode;
    let intersection;

    changingLaneNodes.push({
      x: x + (Math.cos(utils.angleToRadians(roadPathAngle)) * 50),
      y: y + (Math.sin(utils.angleToRadians(roadPathAngle * -1)) * 50),
      roadPath: this.currentRoadPath,
      beforeLaneChange: true
    });

    const diagonalPos = {
      x: changingLaneNodes[0].x + Math.cos(utils.angleToRadians(newAngle)) * 10,
      y: changingLaneNodes[0].y + Math.sin(utils.angleToRadians(newAngle * -1)) * 10
    };

    for(let i = 1; i <= crossRoadPathsLen; i++) {
      tempRoadPath = this.currentRoadPath.way.lanes[this.currentRoadPath.order + (mod * i * -1)];
      tempRoadPathDeepestNode = tempRoadPath.getDeepestPoint();
      intersection = utils.getLinesIntersection(
        changingLaneNodes[0].x,
        changingLaneNodes[0].y,
        diagonalPos.x,
        diagonalPos.y,
        tempRoadPath.initPoint.x,
        tempRoadPath.initPoint.y,
        tempRoadPathDeepestNode.x,
        tempRoadPathDeepestNode.y
      );

      changingLaneNodes.push({
        x: intersection.x,
        y: intersection.y,
        roadPath: tempRoadPath,
        direction,
        laneChange: true
      });
    }

    const lastChangeNode = changingLaneNodes[changingLaneNodes.length - 1];
    const nextRoadPathNode = targetRoadPath.getNextNodeFrom(lastChangeNode.x, lastChangeNode.y);

    return [
      ...changingLaneNodes,
      ...RoadPath.getPathUntilNode(nextRoadPathNode, this.route[this.routeIdx])
    ];
  }

  update() {
    if(this.broken || this.routeIdx === null) {
      return;
    }

    const detailRouteNode = this.detailedRoute[this.detailedRouteIdx];
    const detailRouteNodeDist = utils.getPointsDistance(detailRouteNode.x, detailRouteNode.y, this.position.x, this.position.y);

    if(detailRouteNodeDist <= this.maxVelocity) {
      this.onArriveDetailedRoute();
    }

    if(this.routeIdx === null) {
      return;
    }

    this.calculateCarReaction();
    this.calculateNextPosition();
  }
}

export default Car;
